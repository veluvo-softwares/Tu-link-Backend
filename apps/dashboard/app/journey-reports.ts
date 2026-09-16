export interface JourneyReport {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  destinationName: string | null;
  destinationAddress: string | null;
  createdAt: string;
  scheduledFor: string | null;
  startTime: string | null;
  endTime: string | null;
}

export const durationGroups = [
  'Under 30 minutes',
  '30–60 minutes',
  '1–2 hours',
  '2+ hours',
  'In progress',
  'Not started',
  'Duration unavailable',
] as const;
export type DurationGroup = (typeof durationGroups)[number];

export function durationSeconds(journey: JourneyReport): number | null {
  if (
    !journey.startTime ||
    !journey.endTime ||
    !['COMPLETED', 'CANCELLED'].includes(journey.status)
  )
    return null;
  const start = Date.parse(journey.startTime);
  const end = Date.parse(journey.endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? (end - start) / 1000
    : null;
}

export function durationGroup(journey: JourneyReport): DurationGroup {
  if (journey.status === 'ACTIVE') return 'In progress';
  if (journey.status === 'PENDING') return 'Not started';
  const seconds = durationSeconds(journey);
  if (seconds === null) return 'Duration unavailable';
  if (seconds < 1800) return 'Under 30 minutes';
  if (seconds < 3600) return '30–60 minutes';
  if (seconds < 7200) return '1–2 hours';
  return '2+ hours';
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Not available';
  if (seconds < 60) return `${Math.floor(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function reportDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(value));
}

// Keep report props limited to the fields rendered in the report; never pass
// full journey records (including invitation codes) into the client component.
export function reportFields(value: JourneyReport): JourneyReport {
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    destinationName: value.destinationName ?? null,
    destinationAddress: value.destinationAddress ?? null,
    createdAt: value.createdAt,
    scheduledFor: value.scheduledFor ?? null,
    startTime: value.startTime ?? null,
    endTime: value.endTime ?? null,
  };
}
