import { Timestamp } from 'firebase-admin/firestore';

/**
 * Converts Firestore Timestamp or Date to ISO 8601 string
 * Ensures all dates are returned in consistent ISO 8601 format
 */
export function toISOString(value: any): string | undefined {
  if (!value) {
    return undefined;
  }

  // If it's already a string, return it
  if (typeof value === 'string') {
    return value;
  }

  // If it's a Firestore Timestamp
  if (value instanceof Timestamp || (value && typeof value.toDate === 'function')) {
    return value.toDate().toISOString();
  }

  // If it's a Date object
  if (value instanceof Date) {
    return value.toISOString();
  }

  // If it has seconds and nanoseconds (Firestore Timestamp-like object)
  if (value && typeof value === 'object' && 'seconds' in value) {
    return new Date(value.seconds * 1000).toISOString();
  }

  // Return undefined for unsupported types
  return undefined;
}

/**
 * Converts all Firestore Timestamps in an object to ISO 8601 strings
 * Recursively processes nested objects and arrays
 */
export function convertTimestamps<T = any>(data: any): T {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => convertTimestamps(item)) as any;
  }

  // Handle objects
  const converted: any = {};

  for (const [key, value] of Object.entries(data)) {
    // Convert Timestamp fields
    if (value instanceof Timestamp || (value && typeof value === 'object' && 'toDate' in value)) {
      converted[key] = toISOString(value);
    }
    // Recursively convert nested objects
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      converted[key] = convertTimestamps(value);
    }
    // Recursively convert arrays
    else if (Array.isArray(value)) {
      converted[key] = value.map((item) => convertTimestamps(item));
    }
    // Keep primitive values as is
    else {
      converted[key] = value;
    }
  }

  return converted;
}

/**
 * Converts specific timestamp fields to ISO 8601 strings
 * Useful for converting specific fields like createdAt, updatedAt, etc.
 */
export function convertCommonTimestamps<T extends Record<string, any>>(data: T): T {
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
        (converted as any)[field] = isoString;
      }
    }
  }

  return converted;
}
