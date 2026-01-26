import { Timestamp } from 'firebase-admin/firestore';

interface FirestoreTimestampLike {
  toDate(): Date;
}

interface FirestoreTimestampObjectLike {
  seconds: number;
  nanoseconds?: number;
}

/**
 * Converts Firestore Timestamp or Date to ISO 8601 string
 * Ensures all dates are returned in consistent ISO 8601 format
 */
export function toISOString(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  // If it's already a string, return it
  if (typeof value === 'string') {
    return value;
  }

  // If it's a Firestore Timestamp
  if (
    value instanceof Timestamp ||
    (value &&
      typeof value === 'object' &&
      'toDate' in value &&
      typeof (value as FirestoreTimestampLike).toDate === 'function')
  ) {
    return (value as FirestoreTimestampLike).toDate().toISOString();
  }

  // If it's a Date object
  if (value instanceof Date) {
    return value.toISOString();
  }

  // If it has seconds and nanoseconds (Firestore Timestamp-like object)
  if (value && typeof value === 'object' && 'seconds' in value) {
    const timestampLike = value as FirestoreTimestampObjectLike;
    return new Date(timestampLike.seconds * 1000).toISOString();
  }

  // Return undefined for unsupported types
  return undefined;
}

/**
 * Converts all Firestore Timestamps in an object to ISO 8601 strings
 * Recursively processes nested objects and arrays
 */
export function convertTimestamps<T = unknown>(data: unknown): T {
  if (!data || typeof data !== 'object') {
    return data as T;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item: unknown) => convertTimestamps(item)) as T;
  }

  // Handle objects
  const converted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    // Convert Timestamp fields
    if (
      value instanceof Timestamp ||
      (value && typeof value === 'object' && 'toDate' in value)
    ) {
      converted[key] = toISOString(value);
    }
    // Recursively convert nested objects
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      converted[key] = convertTimestamps(value);
    }
    // Recursively convert arrays
    else if (Array.isArray(value)) {
      converted[key] = value.map((item: unknown) => convertTimestamps(item));
    }
    // Keep primitive values as is
    else {
      converted[key] = value;
    }
  }

  return converted as T;
}

/**
 * Converts specific timestamp fields to ISO 8601 strings
 * Useful for converting specific fields like createdAt, updatedAt, etc.
 */
export function convertCommonTimestamps<T extends Record<string, unknown>>(
  data: T,
): T {
  const timestampFields = [
    'createdAt',
    'updatedAt',
    'startTime',
    'endTime',
    'joinedAt',
    'leftAt',
    'lastSeenAt',
    'readAt',
    'timestamp',
    'resolvedAt',
    'acknowledgedAt',
    'lastLogout',
  ];

  const converted = { ...data };

  for (const field of timestampFields) {
    if (field in converted && converted[field]) {
      const isoString = toISOString(converted[field]);
      if (isoString) {
        (converted as Record<string, unknown>)[field] = isoString;
      }
    }
  }

  return converted;
}
