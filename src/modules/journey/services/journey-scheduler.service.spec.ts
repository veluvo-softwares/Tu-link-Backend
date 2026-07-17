import { computeScheduleAction } from './journey-scheduler.service';

describe('computeScheduleAction', () => {
  const now = new Date('2026-07-18T12:00:00Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const HOUR = 60 * 60 * 1000;

  it('does nothing far outside the reminder window', () => {
    expect(computeScheduleAction(at(30 * HOUR), [], false, now)).toBeNull();
  });

  it('sends the 24h reminder once inside the window', () => {
    const decision = computeScheduleAction(at(20 * HOUR), [], false, now);
    expect(decision?.action).toEqual({
      kind: 'reminder',
      tier: '24h',
      tierLabel: 'in the next day',
    });
    expect(decision?.markSent).toEqual(['24h']);
  });

  it('does not repeat an already-sent tier', () => {
    expect(
      computeScheduleAction(at(20 * HOUR), ['24h'], false, now),
    ).toBeNull();
  });

  it('escalates to the most imminent tier and swallows skipped tiers', () => {
    // Journey scheduled 10 minutes out, nothing sent yet: send the 15m
    // reminder only, but mark 24h/1h too so they never fire afterwards.
    const decision = computeScheduleAction(at(10 * 60 * 1000), [], false, now);
    expect(decision?.action).toEqual({
      kind: 'reminder',
      tier: '15m',
      tierLabel: 'in 15 minutes',
    });
    expect(decision?.markSent).toEqual(['24h', '1h', '15m']);
  });

  it('emits start-due at T-0 for manual journeys, once', () => {
    const scheduledFor = at(-60 * 1000);
    const first = computeScheduleAction(
      scheduledFor,
      ['24h', '1h', '15m'],
      false,
      now,
    );
    expect(first?.action).toEqual({ kind: 'start-due' });
    expect(
      computeScheduleAction(
        scheduledFor,
        ['24h', '1h', '15m', 'start-due'],
        false,
        now,
      ),
    ).toBeNull();
  });

  it('emits auto-start at T-0 for autoStart journeys, once', () => {
    const scheduledFor = at(-60 * 1000);
    const first = computeScheduleAction(scheduledFor, [], true, now);
    expect(first?.action).toEqual({ kind: 'auto-start' });
    expect(first?.markSent).toEqual(['auto-start-attempted']);
    expect(
      computeScheduleAction(scheduledFor, ['auto-start-attempted'], true, now),
    ).toBeNull();
  });

  it('nudges the leader after the missed-start grace period, once', () => {
    const scheduledFor = at(-3 * HOUR);
    const first = computeScheduleAction(
      scheduledFor,
      ['start-due'],
      false,
      now,
    );
    expect(first?.action).toEqual({ kind: 'missed-nudge' });
    expect(
      computeScheduleAction(
        scheduledFor,
        ['start-due', 'missed-nudge'],
        false,
        now,
      ),
    ).toBeNull();
  });

  it('auto-cancels a day after the missed start', () => {
    const decision = computeScheduleAction(at(-25 * HOUR), [], false, now);
    expect(decision?.action).toEqual({ kind: 'auto-cancel' });
  });
});
