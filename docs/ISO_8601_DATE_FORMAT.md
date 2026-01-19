# ISO 8601 Date Format Implementation

## Overview

All date and time values returned from the Tu-Link backend API are formatted according to the **ISO 8601 standard**. This ensures consistency, timezone clarity, and universal compatibility across all clients.

## ISO 8601 Format

### Standard Format
```
YYYY-MM-DDTHH:mm:ss.sssZ
```

### Example
```
2026-01-18T17:30:45.123Z
```

### Breakdown
- `YYYY` - Four-digit year (e.g., 2026)
- `MM` - Two-digit month (01-12)
- `DD` - Two-digit day (01-31)
- `T` - Separator between date and time
- `HH` - Two-digit hour in 24-hour format (00-23)
- `mm` - Two-digit minutes (00-59)
- `ss` - Two-digit seconds (00-59)
- `.sss` - Milliseconds (000-999)
- `Z` - UTC timezone indicator (Zulu time)

## Implementation

### Architecture

The backend implements automatic timestamp conversion through a multi-layer approach:

```
┌─────────────────────────────────────────────────────────────┐
│                    Request/Response Flow                     │
└─────────────────────────────────────────────────────────────┘

1. Data Stored in Firestore
   └─► Firestore Timestamp format
       (seconds + nanoseconds since epoch)

2. Data Retrieved by Service
   └─► Still in Firestore Timestamp format

3. TimestampConversionInterceptor (GLOBAL)
   └─► Converts ALL Firestore Timestamps → ISO 8601
       Runs BEFORE ResponseInterceptor

4. ResponseInterceptor (GLOBAL)
   └─► Wraps data in standardized response format
       Adds timestamp: new Date().toISOString()

5. Response Sent to Client
   └─► ALL dates are in ISO 8601 format ✅
```

### Components

#### 1. Date Utility Functions
**File:** `src/common/utils/date.utils.ts`

```typescript
// Convert single Firestore Timestamp to ISO 8601
toISOString(value: any): string | undefined

// Convert all timestamps in an object recursively
convertTimestamps<T>(data: any): T

// Convert common timestamp fields
convertCommonTimestamps<T>(data: T): T
```

#### 2. Timestamp Conversion Interceptor
**File:** `src/common/interceptors/timestamp-conversion.interceptor.ts`

Automatically converts **all** Firestore Timestamps in response data to ISO 8601 strings.

**Registration:** Global (all endpoints)
```typescript
// main.ts
app.useGlobalInterceptors(new TimestampConversionInterceptor());
```

#### 3. Response Interceptor
**File:** `src/common/interceptors/response.interceptor.ts`

Adds ISO 8601 timestamp to standardized response wrapper:
```typescript
{
  timestamp: new Date().toISOString(), // ← ISO 8601
  // ... other fields
}
```

#### 4. Exception Filter
**File:** `src/common/filters/http-exception.filter.ts`

Adds ISO 8601 timestamp to error responses:
```typescript
{
  timestamp: new Date().toISOString(), // ← ISO 8601
  // ... other fields
}
```

## API Response Examples

### User Profile
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "abc123",
    "email": "user@example.com",
    "displayName": "John Doe",
    "createdAt": "2026-01-15T10:30:00.000Z",  ← ISO 8601
    "updatedAt": "2026-01-18T17:45:30.500Z"   ← ISO 8601
  }
}
```

### Update Profile
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "id": "abc123",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "createdAt": "2026-01-15T10:30:00.000Z",  ← ISO 8601
    "updatedAt": "2026-01-18T18:20:15.800Z"   ← ISO 8601 (updated)
  }
}
```

### Journey Details
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "journey123",
    "name": "Road Trip",
    "status": "ACTIVE",
    "createdAt": "2026-01-18T08:00:00.000Z",  ← ISO 8601
    "startTime": "2026-01-18T09:00:00.000Z",  ← ISO 8601
    "endTime": null,
    "updatedAt": "2026-01-18T09:05:00.000Z"   ← ISO 8601
  }
}
```

### Location Update
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "loc123",
    "journeyId": "journey123",
    "userId": "user123",
    "location": {
      "latitude": 40.7128,
      "longitude": -74.0060
    },
    "timestamp": "2026-01-18T17:49:55.789Z"   ← ISO 8601
  }
}
```

### Notification
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "notif123",
    "type": "LAG_ALERT",
    "message": "You are falling behind",
    "createdAt": "2026-01-18T17:45:00.000Z",  ← ISO 8601
    "readAt": "2026-01-18T17:46:30.500Z"      ← ISO 8601
  }
}
```

### Error Response
```json
{
  "success": false,
  "statusCode": 404,
  "message": "User not found",
  "error": {
    "code": "NOT_FOUND"
  }
}
```

## Client-Side Usage

### JavaScript/TypeScript

```typescript
// Parse ISO 8601 string to Date object
const createdAt = new Date("2026-01-18T17:50:00.123Z");

// Display in local timezone
console.log(createdAt.toLocaleString());
// "1/18/2026, 12:50:00 PM" (EST)

// Get specific components
console.log(createdAt.getFullYear());  // 2026
console.log(createdAt.getMonth() + 1); // 1 (January)
console.log(createdAt.getDate());      // 18
console.log(createdAt.getHours());     // 12 (local time)
```

### React Example

```typescript
import { format } from 'date-fns';

function UserProfile({ user }) {
  return (
    <div>
      <p>Created: {format(new Date(user.createdAt), 'PPP')}</p>
      {/* "January 15th, 2026" */}

      <p>Last Updated: {format(new Date(user.updatedAt), 'PPpp')}</p>
      {/* "January 18th, 2026 at 5:45 PM" */}
    </div>
  );
}
```

### Mobile (React Native)

```typescript
import moment from 'moment';

const createdDate = moment(user.createdAt);

// Relative time
console.log(createdDate.fromNow());
// "3 days ago"

// Formatted
console.log(createdDate.format('MMMM Do YYYY, h:mm a'));
// "January 15th 2026, 10:30 am"
```

## Benefits of ISO 8601

### 1. Universal Compatibility
- Works across all programming languages
- Recognized by all modern date/time libraries
- Compatible with databases, APIs, and file formats

### 2. Timezone Clarity
- `Z` suffix indicates UTC time
- Eliminates timezone ambiguity
- Clients can easily convert to local time

### 3. Sortable
```javascript
// ISO 8601 strings sort correctly alphabetically
const dates = [
  "2026-01-18T17:50:00.123Z",
  "2026-01-15T10:30:00.000Z",
  "2026-01-18T09:00:00.000Z"
];

dates.sort();
// [
//   "2026-01-15T10:30:00.000Z",  ← Oldest
//   "2026-01-18T09:00:00.000Z",
//   "2026-01-18T17:50:00.123Z"   ← Newest
// ]
```

### 4. Precision
- Includes milliseconds
- Useful for event ordering and logging

### 5. Human Readable
- Clear year-month-day order
- Easy to read and understand
- No locale-dependent confusion

## Common Date Fields

All these fields are automatically converted to ISO 8601:

| Field | Description | Example |
|-------|-------------|---------|
| `createdAt` | When resource was created | `"2026-01-15T10:30:00.000Z"` |
| `updatedAt` | When resource was last updated | `"2026-01-18T17:45:30.500Z"` |
| `startTime` | When journey/event started | `"2026-01-18T09:00:00.000Z"` |
| `endTime` | When journey/event ended | `"2026-01-18T12:00:00.000Z"` |
| `joinedAt` | When participant joined | `"2026-01-18T09:05:00.000Z"` |
| `leftAt` | When participant left | `"2026-01-18T11:30:00.000Z"` |
| `lastSeenAt` | Last activity timestamp | `"2026-01-18T17:49:00.000Z"` |
| `readAt` | When notification was read | `"2026-01-18T17:46:30.500Z"` |
| `timestamp` | Generic timestamp | `"2026-01-18T17:50:00.123Z"` |
| `resolvedAt` | When issue was resolved | `"2026-01-18T17:40:00.000Z"` |
| `acknowledgedAt` | When acknowledged | `"2026-01-18T17:35:00.000Z"` |
| `lastLogout` | Last logout time | `"2026-01-18T16:00:00.000Z"` |

## Validation

### Input Dates
When sending dates to the API (if needed), use ISO 8601 format:

```typescript
// ✅ Correct
{
  "startTime": "2026-01-18T09:00:00.000Z"
}

// ❌ Wrong - not ISO 8601
{
  "startTime": "01/18/2026 9:00 AM"
}

// ❌ Wrong - missing timezone
{
  "startTime": "2026-01-18T09:00:00"
}
```

### Generating ISO 8601 Timestamps

```javascript
// JavaScript
new Date().toISOString()
// "2026-01-18T17:50:00.123Z"

// Python
from datetime import datetime
datetime.utcnow().isoformat() + 'Z'
# "2026-01-18T17:50:00.123Z"

// Java
Instant.now().toString()
// "2026-01-18T17:50:00.123Z"

// C#
DateTime.UtcNow.ToString("o")
// "2026-01-18T17:50:00.1230000Z"
```

## Testing

### Verify ISO 8601 Format

```bash
# Register user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "displayName": "Test User"
  }' | jq '.data.user'

# User object does not have timestamps on registration
```

### Check All Timestamps

```bash
# Get profile
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer TOKEN" | jq '{
    createdAt: .data.createdAt,
    updatedAt: .data.updatedAt
  }'

# Output:
# {
#   "createdAt": "2026-01-15T10:30:00.000Z",
#   "updatedAt": "2026-01-18T17:45:30.500Z"
# }
```

## Troubleshooting

### Issue: Dates showing in wrong format

**Check:** Are you using the correct field?
```javascript
// ✅ Correct - using ISO 8601 string
console.log(response.data.createdAt);
// "2026-01-18T17:50:00.123Z"

// ❌ Wrong - accessing Firestore Timestamp object directly
console.log(response.data._createdAt);
// { seconds: 1737227400, nanoseconds: 123000000 }
```

### Issue: Timezone confusion

**Remember:** All timestamps are in UTC (Z suffix)
```javascript
const utcDate = new Date("2026-01-18T17:50:00.123Z");
console.log(utcDate.toUTCString());
// "Sat, 18 Jan 2026 17:50:00 GMT"

console.log(utcDate.toLocaleString()); // Your local time
// "1/18/2026, 12:50:00 PM" (EST, -5 hours)
```

## Summary

✅ **All dates** in API responses are in ISO 8601 format
✅ **Automatic conversion** via global interceptor
✅ **Consistent format** across all endpoints
✅ **UTC timezone** (Z suffix) for clarity
✅ **Millisecond precision** for accurate timestamps
✅ **Client-friendly** - works with all date libraries

**Example Format:**
```
2026-01-18T17:50:00.123Z
```

**What It Means:**
- Date: January 18, 2026
- Time: 5:50 PM and 0.123 seconds
- Timezone: UTC (Coordinated Universal Time)

All date handling is implemented and working automatically! 🎉
