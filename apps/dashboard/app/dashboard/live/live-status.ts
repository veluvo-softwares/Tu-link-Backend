export interface LiveLocation {
  journeyId: string;
  participantId: string;
  displayName: string;
  location: {
    latitude: number;
    longitude: number;
  };
  heading?: number;
  speed?: number;
  timestamp: number;
  positionRecordedAt?: number;
  connectionState?: string;
  lastSeenAt?: number;
  metadata?: {
    batteryLevel?: number;
    isMoving?: boolean;
  };
}

export interface LiveJourney {
  journey: {
    id: string;
    name: string;
    destinationAddress: string | null;
  };
  snapshot: {
    participants: Record<string, LiveLocation>;
    destination?: {
      latitude: number;
      longitude: number;
    };
    destinationAddress?: string;
  };
}

export const DELAYED_AFTER_MS = 30_000;
export const OFFLINE_AFTER_MS = 60_000;

export type LocationState = 'reporting' | 'delayed' | 'offline';

export function recordedAt(location: LiveLocation) {
  return location.positionRecordedAt ?? location.timestamp;
}

export function locationState(
  location: LiveLocation,
  now: number,
): LocationState {
  const age = now - recordedAt(location);
  if (location.connectionState === 'DISCONNECTED' || age >= OFFLINE_AFTER_MS) {
    return 'offline';
  }
  if (location.connectionState !== 'CONNECTED' || age >= DELAYED_AFTER_MS) {
    return 'delayed';
  }
  return 'reporting';
}

export function journeyStatus(item: LiveJourney, now: number) {
  const members = Object.values(item.snapshot.participants);
  const attentionReasons = members.flatMap((member) => {
    const state = locationState(member, now);
    if (state === 'offline') return ['Driver offline'];
    if (state === 'delayed') return ['Stale location'];
    return [];
  });
  const latestTimestamp = members.reduce(
    (latest, member) => Math.max(latest, recordedAt(member)),
    0,
  );
  const reportingCount = members.filter(
    (member) => locationState(member, now) === 'reporting',
  ).length;

  return {
    attentionCount: attentionReasons.length,
    attentionReasons: [...new Set(attentionReasons)],
    latestTimestamp,
    memberCount: members.length,
    reportingCount,
    leadName: members[0]?.displayName ?? null,
  };
}

export function summarizeLiveFeed(journeys: LiveJourney[], now: number) {
  const perJourney = journeys.map((item) => ({
    item,
    status: journeyStatus(item, now),
  }));
  const attentionJourneys = perJourney.filter(
    (entry) => entry.status.attentionCount > 0,
  );
  const reasons = [...new Set(attentionJourneys.flatMap((entry) => entry.status.attentionReasons))];
  const driversOnline = perJourney.reduce(
    (count, entry) => count + entry.status.reportingCount,
    0,
  );
  const visibleMembers = perJourney.reduce(
    (count, entry) => count + entry.status.memberCount,
    0,
  );

  return {
    attentionJourneys,
    attentionCount: attentionJourneys.length,
    reasons,
    driversOnline,
    visibleMembers,
  };
}
