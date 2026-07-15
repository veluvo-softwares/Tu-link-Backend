import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  ConnectionStatus,
  ParticipantRole,
  ParticipantStatus,
} from '../../types/participant-status.type';
import { DatabaseService } from '../database.service';
import { ParticipantDeviceInfo, participants, users } from '../schema';

export interface ParticipantRecord {
  id: string; // = userId (invariant A)
  userId: string;
  journeyId: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  invitedBy: string | null;
  connectionStatus: ConnectionStatus;
  joinedAt: Date | null;
  leftAt: Date | null;
  lastSeenAt: Date | null;
  arrivedAt: Date | null;
  convergedAt: Date | null;
  deviceInfo: ParticipantDeviceInfo | null;
  displayName?: string;
}

export interface AddParticipantInput {
  journeyId: string;
  userId: string;
  invitedBy: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  setJoinedAt?: boolean;
}

type Row = typeof participants.$inferSelect;

const toRecord = (row: Row, displayName?: string): ParticipantRecord => ({
  id: row.userId,
  userId: row.userId,
  journeyId: row.journeyId,
  role: row.role,
  status: row.status,
  invitedBy: row.invitedBy,
  connectionStatus: row.connectionStatus,
  joinedAt: row.joinedAt,
  leftAt: row.leftAt,
  lastSeenAt: row.lastSeenAt,
  arrivedAt: row.arrivedAt,
  convergedAt: row.convergedAt,
  deviceInfo: row.deviceInfo,
  ...(displayName !== undefined ? { displayName } : {}),
});

@Injectable()
export class ParticipantRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  // Upsert on the composite PK so re-invitation overwrites a prior
  // DECLINED/LEFT row (matches the Firestore .set() semantics).
  async add(input: AddParticipantInput): Promise<ParticipantRecord> {
    const [row] = await this.db
      .insert(participants)
      .values({
        journeyId: input.journeyId,
        userId: input.userId,
        invitedBy: input.invitedBy,
        role: input.role,
        status: input.status,
        connectionStatus: 'DISCONNECTED',
        joinedAt: input.setJoinedAt ? sql`now()` : null,
      })
      .onConflictDoUpdate({
        target: [participants.journeyId, participants.userId],
        set: {
          invitedBy: input.invitedBy,
          role: input.role,
          status: input.status,
          joinedAt: input.setJoinedAt ? sql`now()` : null,
          // Re-invitation overwrites a prior DECLINED/LEFT/ARRIVED row, so the
          // stale lifecycle timestamps and connection state must be cleared.
          leftAt: null,
          arrivedAt: null,
          convergedAt: null,
          lastSeenAt: null,
          connectionStatus: 'DISCONNECTED',
        },
      })
      .returning();
    return toRecord(row);
  }

  async findOne(
    journeyId: string,
    userId: string,
  ): Promise<ParticipantRecord | null> {
    const [row] = await this.db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.journeyId, journeyId),
          eq(participants.userId, userId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  // Single JOIN replaces the per-participant user fetch (kills the N+1).
  async findByJourney(journeyId: string): Promise<ParticipantRecord[]> {
    const rows = await this.db
      .select({
        participant: participants,
        displayName: users.displayName,
      })
      .from(participants)
      .leftJoin(users, eq(participants.userId, users.id))
      .where(eq(participants.journeyId, journeyId));

    return rows.map((r) =>
      toRecord(r.participant, r.displayName ?? 'Unknown User'),
    );
  }

  // Replaces collectionGroup('participants').where('userId','==',u).
  async findByUser(
    userId: string,
    statuses?: ParticipantStatus[],
  ): Promise<ParticipantRecord[]> {
    const where =
      statuses && statuses.length > 0
        ? and(
            eq(participants.userId, userId),
            inArray(participants.status, statuses),
          )
        : eq(participants.userId, userId);

    const rows = await this.db.select().from(participants).where(where);
    return rows.map((row) => toRecord(row));
  }

  private async patch(
    journeyId: string,
    userId: string,
    set: Record<string, unknown>,
  ): Promise<ParticipantRecord | null> {
    const [row] = await this.db
      .update(participants)
      .set(set)
      .where(
        and(
          eq(participants.journeyId, journeyId),
          eq(participants.userId, userId),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  private async transition(
    journeyId: string,
    userId: string,
    from: ParticipantStatus[],
    set: Record<string, unknown>,
  ): Promise<ParticipantRecord | null> {
    const [row] = await this.db
      .update(participants)
      .set(set)
      .where(
        and(
          eq(participants.journeyId, journeyId),
          eq(participants.userId, userId),
          inArray(participants.status, from),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  accept(journeyId: string, userId: string): Promise<ParticipantRecord | null> {
    return this.transition(journeyId, userId, ['INVITED'], {
      status: 'ACCEPTED',
      joinedAt: sql`now()`,
    });
  }

  // Active-journey accept path: straight to ACTIVE.
  activate(
    journeyId: string,
    userId: string,
  ): Promise<ParticipantRecord | null> {
    return this.transition(journeyId, userId, ['INVITED'], {
      status: 'ACTIVE',
      joinedAt: sql`now()`,
    });
  }

  decline(
    journeyId: string,
    userId: string,
  ): Promise<ParticipantRecord | null> {
    return this.transition(journeyId, userId, ['INVITED'], {
      status: 'DECLINED',
    });
  }

  leave(journeyId: string, userId: string): Promise<ParticipantRecord | null> {
    return this.transition(
      journeyId,
      userId,
      ['ACCEPTED', 'ACTIVE', 'ARRIVED'],
      {
        status: 'LEFT',
        leftAt: sql`now()`,
        connectionStatus: 'DISCONNECTED',
      },
    );
  }

  markArrived(
    journeyId: string,
    userId: string,
  ): Promise<ParticipantRecord | null> {
    return this.patch(journeyId, userId, {
      status: 'ARRIVED',
      arrivedAt: sql`now()`,
    });
  }

  // Atomic arrival transition: only flips a not-yet-ARRIVED participant. Returns
  // the row when this call performed the update, null when it was already
  // ARRIVED (or the participant does not exist) — lets callers avoid the
  // check-then-update race that would fire duplicate arrival side effects.
  async markArrivedIfNotArrived(
    journeyId: string,
    userId: string,
  ): Promise<ParticipantRecord | null> {
    const [row] = await this.db
      .update(participants)
      .set({ status: 'ARRIVED', arrivedAt: sql`now()` })
      .where(
        and(
          eq(participants.journeyId, journeyId),
          eq(participants.userId, userId),
          ne(participants.status, 'ARRIVED'),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  // Atomic convergence transition: only flips a not-yet-converged participant.
  // Returns the row when this call performed the update, null when it was
  // already converged (or the participant does not exist) — the isNull guard
  // (instead of markArrivedIfNotArrived's status check) makes the D-06
  // "permanent, first-time-only" guarantee race-safe without a separate
  // check-then-update.
  async setConvergedIfNotConverged(
    journeyId: string,
    userId: string,
  ): Promise<ParticipantRecord | null> {
    const [row] = await this.db
      .update(participants)
      .set({ convergedAt: sql`now()` })
      .where(
        and(
          eq(participants.journeyId, journeyId),
          eq(participants.userId, userId),
          isNull(participants.convergedAt),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  setConnectionStatus(
    journeyId: string,
    userId: string,
    status: ConnectionStatus,
  ): Promise<ParticipantRecord | null> {
    return this.patch(journeyId, userId, {
      connectionStatus: status,
      lastSeenAt: sql`now()`,
    });
  }

  // journey.start(): promote every ACCEPTED participant (and the LEADER) to
  // ACTIVE in one statement.
  async activateForStart(journeyId: string): Promise<void> {
    await this.db
      .update(participants)
      .set({ status: 'ACTIVE' })
      .where(
        and(
          eq(participants.journeyId, journeyId),
          or(
            eq(participants.status, 'ACCEPTED'),
            eq(participants.role, 'LEADER'),
          ),
        ),
      );
  }

  async releaseJoinedMemberships(journeyId: string): Promise<void> {
    await this.db
      .update(participants)
      .set({
        status: 'LEFT',
        leftAt: sql`now()`,
        connectionStatus: 'DISCONNECTED',
      })
      .where(
        and(
          eq(participants.journeyId, journeyId),
          inArray(participants.status, ['ACCEPTED', 'ACTIVE', 'ARRIVED']),
        ),
      );
  }
}
