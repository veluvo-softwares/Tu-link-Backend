import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JourneyRepository } from '../../../database/repositories/journey.repository';
import { RedisService } from '../../../shared/redis/redis.service';
import { LoggerService } from '../../../shared/logger/logger.service';
import { NotificationService } from '../../notification/notification.service';
import { JourneyService } from '../journey.service';
import { ParticipantService } from './participant.service';

/** One decision per journey per tick, most urgent wins. */
export type ScheduleAction =
  | { kind: 'reminder'; tier: ReminderTierKey; tierLabel: string }
  | { kind: 'auto-start' }
  | { kind: 'start-due' }
  | { kind: 'missed-nudge' }
  | { kind: 'auto-cancel' };

export type ReminderTierKey = '24h' | '1h' | '15m';

const HOUR_MS = 60 * 60 * 1000;

const REMINDER_TIERS: Array<{
  key: ReminderTierKey;
  ms: number;
  label: string;
}> = [
  { key: '24h', ms: 24 * HOUR_MS, label: 'in the next day' },
  { key: '1h', ms: HOUR_MS, label: 'in about an hour' },
  { key: '15m', ms: 15 * 60 * 1000, label: 'in 15 minutes' },
];

/** Leader hasn't started this long after the scheduled instant → nudge. */
const MISSED_NUDGE_AFTER_MS = 2 * HOUR_MS;
/** …and this long after → cancel so the leader's open-journey slot frees up. */
const AUTO_CANCEL_AFTER_MS = 24 * HOUR_MS;

/**
 * Pure decision function for one scheduled journey at one instant.
 * Exported for unit tests. Returns the action that is due (if any) and the
 * reminder keys to persist so the same action never fires twice.
 */
export function computeScheduleAction(
  scheduledFor: Date,
  remindersSent: string[],
  autoStart: boolean,
  now: Date,
): { action: ScheduleAction; markSent: string[] } | null {
  const msUntil = scheduledFor.getTime() - now.getTime();

  if (msUntil > 0) {
    // A tier is due once we're inside its window. Send only the most
    // imminent unsent tier, but mark every due tier as sent so a journey
    // scheduled 30 minutes out doesn't later get a stale "24h" reminder.
    const dueTiers = REMINDER_TIERS.filter((tier) => msUntil <= tier.ms);
    const unsent = dueTiers.filter((t) => !remindersSent.includes(t.key));
    if (unsent.length === 0) return null;
    const mostImminent = unsent[unsent.length - 1];
    return {
      action: {
        kind: 'reminder',
        tier: mostImminent.key,
        tierLabel: mostImminent.label,
      },
      markSent: dueTiers.map((t) => t.key),
    };
  }

  const overdueMs = -msUntil;

  if (overdueMs > AUTO_CANCEL_AFTER_MS) {
    return { action: { kind: 'auto-cancel' }, markSent: ['auto-cancel'] };
  }

  if (overdueMs > MISSED_NUDGE_AFTER_MS) {
    if (remindersSent.includes('missed-nudge')) return null;
    return { action: { kind: 'missed-nudge' }, markSent: ['missed-nudge'] };
  }

  if (autoStart && !remindersSent.includes('auto-start-attempted')) {
    return {
      action: { kind: 'auto-start' },
      markSent: ['auto-start-attempted'],
    };
  }

  if (!autoStart && !remindersSent.includes('start-due')) {
    return { action: { kind: 'start-due' }, markSent: ['start-due'] };
  }

  return null;
}

/**
 * Drives scheduled journeys: reminder ladder before the start instant,
 * auto-start or leader call-to-action at T-0, nudge and eventual cancel
 * when the start is missed. Runs in-process (no queue infra); a Redis
 * NX lock keeps the tick single-writer if multiple instances ever run.
 */
@Injectable()
export class JourneySchedulerService {
  constructor(
    private readonly journeyRepository: JourneyRepository,
    private readonly journeyService: JourneyService,
    private readonly participantService: ParticipantService,
    private readonly notificationService: NotificationService,
    private readonly redisService: RedisService,
    private readonly logger: LoggerService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      const locked = await this.redisService
        .getClient()
        .set('journeys:scheduler:lock', '1', 'EX', 55, 'NX');
      if (!locked) return;
    } catch {
      // Redis down: skip this tick rather than risk double-sending from
      // concurrent instances. The next tick retries.
      return;
    }

    const now = new Date();
    let due: Awaited<ReturnType<JourneyRepository['findScheduledWithin']>> = [];
    try {
      due = await this.journeyRepository.findScheduledWithin(
        new Date(now.getTime() + 24 * HOUR_MS),
      );
    } catch (error) {
      this.logger.error(
        `Scheduler scan failed: ${String(error)}`,
        undefined,
        'JourneyScheduler',
      );
      return;
    }

    for (const journey of due) {
      try {
        await this.processJourney(journey, now);
      } catch (error) {
        // One bad journey must not starve the rest of the batch.
        this.logger.error(
          `Scheduler failed for journey ${journey.id}: ${String(error)}`,
          undefined,
          'JourneyScheduler',
        );
      }
    }
  }

  private async processJourney(
    journey: Awaited<
      ReturnType<JourneyRepository['findScheduledWithin']>
    >[number],
    now: Date,
  ): Promise<void> {
    if (!journey.scheduledFor) return;

    const remindersSent = journey.metadata.remindersSent ?? [];
    const decision = computeScheduleAction(
      journey.scheduledFor,
      remindersSent,
      journey.metadata.autoStart === true,
      now,
    );
    if (!decision) return;

    // Persist the dedupe marker BEFORE side effects: a crash mid-action means
    // a lost notification, which beats a duplicate blast every minute.
    await this.journeyRepository.updateMetadata(journey.id, {
      ...journey.metadata,
      remindersSent: [...new Set([...remindersSent, ...decision.markSent])],
    });

    const { action } = decision;
    switch (action.kind) {
      case 'reminder': {
        const recipients = await this.reminderRecipients(
          journey.id,
          // The 1h tier also nudges INVITED users who haven't responded.
          action.tier === '1h',
        );
        if (recipients.length > 0) {
          await this.notificationService.sendJourneyReminder(
            journey.id,
            journey.name,
            action.tierLabel,
            recipients,
          );
        }
        return;
      }

      case 'auto-start': {
        try {
          await this.journeyService.start(journey.id, journey.leaderId);
          this.logger.info(
            `Auto-started scheduled journey ${journey.id}`,
            'JourneyScheduler',
          );
        } catch (error) {
          // Typically ALREADY_IN_ACTIVE_JOURNEY — fall back to the manual
          // call-to-action so the humans can resolve it.
          this.logger.warn(
            `Auto-start failed for ${journey.id}: ${String(error)}`,
            'JourneyScheduler',
          );
          await this.sendStartingNow(
            journey.id,
            journey.name,
            journey.leaderId,
          );
        }
        return;
      }

      case 'start-due':
        await this.sendStartingNow(journey.id, journey.name, journey.leaderId);
        return;

      case 'missed-nudge':
        await this.notificationService.sendJourneyMissedStart(
          journey.id,
          journey.name,
          journey.leaderId,
        );
        return;

      case 'auto-cancel':
        // Existing cancel path: leader-scoped, PENDING-guarded, and fans out
        // JOURNEY cancelled notifications to invited/accepted members.
        await this.journeyService.delete(journey.id, journey.leaderId);
        this.logger.info(
          `Auto-cancelled missed scheduled journey ${journey.id}`,
          'JourneyScheduler',
        );
        return;
    }
  }

  private async sendStartingNow(
    journeyId: string,
    journeyName: string,
    leaderId: string,
  ): Promise<void> {
    const members = (await this.reminderRecipients(journeyId, false)).filter(
      (id) => id !== leaderId,
    );
    await this.notificationService.sendJourneyStartingNow(
      journeyId,
      journeyName,
      leaderId,
      members,
    );
  }

  private async reminderRecipients(
    journeyId: string,
    includeInvited: boolean,
  ): Promise<string[]> {
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);
    return participants
      .filter(
        (p) =>
          p.role === 'LEADER' ||
          p.status === 'ACCEPTED' ||
          (includeInvited && p.status === 'INVITED'),
      )
      .map((p) => p.userId);
  }
}
