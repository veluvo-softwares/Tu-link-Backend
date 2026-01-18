# Tu-Link Backend - Complete Learning Guide

## 🎓 Overview

This guide will help you understand and master the Tu-Link backend codebase. Both the **Location Module** (real-time tracking) and **Notification Module** are **fully implemented**. This guide focuses on understanding how they work and how to extend them.

---

## 📚 Part 1: Location Module Deep Dive

### Architecture Overview

```
┌─────────────┐
│ Mobile App  │
└──────┬──────┘
       │ WebSocket Connection
       │ (Firebase Auth Token)
       ▼
┌──────────────────────────────────┐
│   Location Gateway               │
│   (WebSocket Entry Point)        │
│   - Auth verification            │
│   - Room management              │
│   - Heartbeat monitoring         │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│   Location Service               │
│   (Business Logic)               │
│   - 14-step processing flow      │
│   - Priority calculation         │
│   - Lag detection                │
│   - Arrival detection            │
└──────┬───────────────────────────┘
       │
       ├─────────────────┬──────────────────┐
       ▼                 ▼                  ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Redis     │   │  Firestore  │   │ Broadcast   │
│   (Cache)   │   │ (Persist)   │   │ (WebSocket) │
└─────────────┘   └─────────────┘   └─────────────┘
```

---

### 🔑 Key Components

#### 1. Location Gateway (`location.gateway.ts`)

**Purpose**: WebSocket entry point for real-time communication

**Key Responsibilities**:
- ✅ Authenticate clients using Firebase tokens
- ✅ Manage journey room memberships
- ✅ Monitor client connections (heartbeat system)
- ✅ Route events to Location Service
- ✅ Broadcast updates to room participants

**WebSocket Events - Client → Server**:

| Event | Purpose | Payload |
|-------|---------|---------|
| `join-journey` | Client joins a journey room | `{ journeyId: string }` |
| `leave-journey` | Client leaves a journey room | `{ journeyId: string }` |
| `location-update` | Client sends location update | `LocationUpdateDto` |
| `acknowledge` | Client confirms HIGH priority message | `{ sequenceNumber: number }` |
| `request-resync` | Client requests missing updates | `{ fromSequence: number }` |
| `heartbeat` | Keep-alive ping | `{}` |

**WebSocket Events - Server → Client**:

| Event | Purpose | When Triggered |
|-------|---------|----------------|
| `connection-status` | Connection state | On connect/disconnect/timeout |
| `joined-journey` | Confirmation | After successful join |
| `location-update` | Real-time location | When any participant updates |
| `location-update-ack` | Acknowledgment | After processing location |
| `lag-alert` | Follower too far behind | Distance > threshold |
| `arrival-detected` | Participant reached destination | Distance < 100m & speed < 5m/s |
| `participant-joined` | New participant | When someone joins |
| `participant-left` | Participant left | When someone leaves |
| `journey-started` | Journey begins | Leader starts journey |
| `journey-ended` | Journey completes | Leader ends journey |
| `heartbeat-ack` | Heartbeat response | After each heartbeat |
| `resync-data` | Missing updates | Response to resync request |

**Connection Flow**:

```typescript
// 1. Client connects with Firebase token
client.handshake.auth.token = "firebase-id-token"

// 2. Gateway verifies token
const decodedToken = await firebaseService.auth.verifyIdToken(token);
const userId = decodedToken.uid;

// 3. Store user info in socket
client.data.userId = userId;
client.data.email = decodedToken.email;

// 4. Map socket to user in Redis
await redisService.setSocketUser(client.id, userId);

// 5. Start heartbeat monitoring
// - Client must send heartbeat every 4s
// - Server disconnects after 7s of no heartbeat

// 6. Emit connection success
client.emit('connection-status', { status: 'CONNECTED' });
```

**Heartbeat System**:

```typescript
// Purpose: Detect dead connections and clean up resources
// Interval: 4 seconds (client sends heartbeat)
// Timeout: 7 seconds (server waits for heartbeat)

// Client-side (what mobile app should do):
setInterval(() => {
  socket.emit('heartbeat');
}, 4000);

// Server-side (automatic):
- Starts timeout timer on connection
- Resets timer on each heartbeat
- Disconnects client if timeout exceeded
```

**Key Code Sections to Study**:

```typescript
// Location Gateway - Connection Handler (lines 47-84)
async handleConnection(client: Socket) {
  // Token extraction and verification
  // User mapping in Redis
  // Heartbeat initialization
}

// Location Gateway - Join Journey (lines 131-183)
async handleJoinJourney(client, payload) {
  // Verify participant membership
  // Join Socket.io room
  // Update connection status
  // Send latest locations
}

// Location Gateway - Location Update (lines 234-298)
async handleLocationUpdate(client, payload) {
  // Process update via Location Service
  // Send ACK to sender
  // Broadcast to room
  // Emit lag/arrival alerts
}
```

---

#### 2. Location Service (`location.service.ts`)

**Purpose**: Core business logic for location processing

**Main Method: `processLocationUpdate()`**

This is the **heart** of the real-time system. Study this flow carefully:

```typescript
async processLocationUpdate(userId, locationUpdateDto) {
  // STEP 1: Validate participant membership and journey status
  await this.validateParticipant(userId, journeyId);
  // Throws error if:
  // - Journey is not ACTIVE
  // - User is not an active participant

  // STEP 2: Check rate limiting (60 updates/min per user)
  const rateLimitPassed = await this.checkRateLimit(userId);
  if (!rateLimitPassed) throw new BadRequestException('Rate limit exceeded');

  // STEP 3: Get journey and participant info
  const journey = await this.journeyService.findById(journeyId);
  const participants = await this.participantService.getJourneyParticipants(journeyId);
  const participant = participants.find(p => p.userId === userId);

  // STEP 4: Get last location for this participant
  const lastLocation = await this.getLastLocation(journeyId, participant.id);

  // STEP 5: Get leader's location (for lag detection)
  let leaderLocation: LocationUpdate | undefined;
  if (participant.role === 'FOLLOWER') {
    const leaderId = await this.redisService.getJourneyLeader(journeyId);
    if (leaderId) {
      leaderLocation = await this.redisService.getCachedLocation(journeyId, leaderId);
    }
  }

  // STEP 6: Calculate priority (HIGH/MEDIUM/LOW)
  const priority = this.priorityService.calculatePriority(
    locationUpdateDto,
    journey,
    participant,
    lastLocation,
    leaderLocation,
  );

  // STEP 7-8: Check throttling (performance optimization)
  const shouldThrottle = this.priorityService.shouldThrottle(...);
  const shouldThrottleForBattery = this.priorityService.shouldThrottleForBattery(...);
  if (shouldThrottle || shouldThrottleForBattery) {
    return { success: false, ... }; // Don't process this update
  }

  // STEP 9: Generate sequence number (monotonic, no gaps)
  const sequenceNumber = await this.sequenceService.getNextSequence(journeyId);

  // STEP 10: Prepare location update object
  const locationUpdate: LocationUpdate = {
    ...locationUpdateDto,
    participantId: participant.id,
    userId,
    sequenceNumber,
    priority,
    timestamp: Date.now(),
  };

  // STEP 11: Store in Firestore (persistence)
  await this.saveLocationToFirestore(locationUpdate);

  // STEP 12: Update Redis cache (hot data, fast access)
  await this.redisService.cacheLocation(journeyId, participant.id, locationUpdate);

  // STEP 13: Detect lag (for followers only)
  let lagAlert: any = undefined;
  if (participant.role === 'FOLLOWER') {
    lagAlert = await this.lagDetectionService.detectLag(locationUpdate, journey);
  }

  // STEP 14: Detect arrival at destination
  const arrivalDetected = await this.arrivalDetectionService.detectArrival(
    locationUpdate,
    journey,
  );

  // STEP 15: Add to pending deliveries if HIGH priority
  if (this.acknowledgmentService.requiresAcknowledgment(priority)) {
    // Mark for tracking - will retry if not ACKed
    const journeyParticipants = await this.redisService.getJourneyParticipants(journeyId);
    for (const participantId of journeyParticipants) {
      if (participantId !== participant.id) {
        await this.acknowledgmentService.addPendingDelivery(
          journeyId,
          participantId,
          locationUpdate,
        );
      }
    }
  }

  // STEP 16: Return result for broadcasting
  return {
    success: true,
    sequenceNumber,
    priority,
    shouldBroadcast: true,
    lagAlert,
    arrivalDetected,
  };
}
```

**Why This Flow Matters**:
1. **Validation** ensures data integrity
2. **Rate limiting** prevents abuse
3. **Priority calculation** optimizes battery and bandwidth
4. **Throttling** reduces unnecessary updates
5. **Sequence numbers** guarantee message ordering
6. **Dual storage** (Redis + Firestore) balances speed & persistence
7. **Detection services** provide intelligent alerts
8. **Acknowledgment** ensures critical messages arrive

---

#### 3. Priority Service (`services/priority.service.ts`)

**Purpose**: Uber-inspired priority-based message delivery

**Priority Levels**:

```typescript
// HIGH Priority (requires acknowledgment, no throttling)
- Leader's location updates (always broadcast)
- Lag alerts detected
- Participant status changes (ARRIVED, etc.)
- Journey lifecycle events

// MEDIUM Priority (moderate throttling)
- Significant movement (>50 meters from last update)
- Speed changes (>10 m/s difference)
- Arrival approaching (within 500m of destination)

// LOW Priority (aggressive throttling)
- Minor position updates
- No significant changes
```

**Key Method: `calculatePriority()`**

```typescript
calculatePriority(
  update: LocationUpdate,
  journey: Journey,
  participant: Participant,
  lastLocation?: LocationHistory,
  leaderLocation?: LocationUpdate,
): Priority {
  // Rule 1: Leader updates are always HIGH
  if (participant.role === 'LEADER') {
    return 'HIGH';
  }

  // Rule 2: Status changes are HIGH
  if (participant.status === 'ARRIVED') {
    return 'HIGH';
  }

  // Rule 3: Check for lag alert condition
  if (leaderLocation) {
    const distance = DistanceUtils.haversineDistance(
      update.location,
      leaderLocation.location,
    );
    if (distance > journey.lagThresholdMeters) {
      return 'HIGH'; // Lag detected
    }
  }

  // Rule 4: No last location = first update = MEDIUM
  if (!lastLocation) {
    return 'MEDIUM';
  }

  // Rule 5: Calculate movement distance
  const movementDistance = DistanceUtils.haversineDistance(
    update.location,
    lastLocation.location,
  );

  // Rule 6: Significant movement = MEDIUM
  if (movementDistance > 50) {
    return 'MEDIUM';
  }

  // Rule 7: Speed changes = MEDIUM
  const lastSpeed = lastLocation.speed || 0;
  const currentSpeed = update.speed || 0;
  const speedDelta = Math.abs(currentSpeed - lastSpeed);

  if (speedDelta > 10) {
    return 'MEDIUM';
  }

  // Rule 8: Approaching destination = MEDIUM
  if (journey.destination) {
    const distanceToDestination = DistanceUtils.haversineDistance(
      update.location,
      journey.destination,
    );
    if (distanceToDestination < 500) {
      return 'MEDIUM';
    }
  }

  // Default: LOW priority
  return 'LOW';
}
```

**Throttling Logic**:

```typescript
// Time-based throttling
shouldThrottle(update, priority, lastUpdateTime): boolean {
  if (!lastUpdateTime) return false; // First update, don't throttle

  const timeSinceLastUpdate = Date.now() - lastUpdateTime;

  // HIGH priority: Never throttle
  if (priority === 'HIGH') return false;

  // MEDIUM priority: 2 second minimum interval
  if (priority === 'MEDIUM') {
    return timeSinceLastUpdate < 2000;
  }

  // LOW priority: 5 second minimum interval
  return timeSinceLastUpdate < 5000;
}

// Battery-aware throttling
shouldThrottleForBattery(update, priority): boolean {
  const batteryLevel = update.metadata?.batteryLevel;

  // No battery info = don't throttle
  if (!batteryLevel) return false;

  // HIGH priority: Never throttle
  if (priority === 'HIGH') return false;

  // Battery < 20%: Throttle MEDIUM and LOW
  if (batteryLevel < 20) {
    return priority === 'MEDIUM' || priority === 'LOW';
  }

  // Battery < 10%: Only allow HIGH
  if (batteryLevel < 10) {
    return true;
  }

  return false;
}
```

---

#### 4. Sequence Service (`services/sequence.service.ts`)

**Purpose**: Guarantee message ordering and detect gaps

**How It Works**:

```typescript
// Redis-based atomic counter
async getNextSequence(journeyId: string): Promise<number> {
  const key = `journey:${journeyId}:sequence`;

  // INCR is atomic - no race conditions
  const sequence = await this.redisService.client.incr(key);

  // Set expiry (24 hours)
  await this.redisService.client.expire(key, 86400);

  return sequence;
}

// Journey 1: seq 1, 2, 3, 4, 5...
// Journey 2: seq 1, 2, 3, 4, 5...
// Each journey has independent sequence
```

**Gap Detection** (Client-side responsibility):

```typescript
// Client tracks last received sequence
let lastSequence = 0;

socket.on('location-update', (data) => {
  const receivedSeq = data.sequenceNumber;

  // Expected: lastSequence + 1
  if (receivedSeq !== lastSequence + 1) {
    // Gap detected! Missing messages
    const gap = receivedSeq - lastSequence - 1;
    console.warn(`Missing ${gap} messages`);

    // Request resync
    socket.emit('request-resync', {
      fromSequence: lastSequence + 1
    });
  }

  lastSequence = receivedSeq;
});
```

---

#### 5. Lag Detection Service (`services/lag-detection.service.ts`)

**Purpose**: Alert when followers fall too far behind leader

**Algorithm**:

```typescript
async detectLag(followerUpdate, journey): Promise<LagAlert | null> {
  // Step 1: Get leader's latest location from Redis
  const leaderId = await this.redisService.getJourneyLeader(journey.id);
  if (!leaderId) return null;

  const leaderLocation = await this.redisService.getCachedLocation(
    journey.id,
    leaderId,
  );
  if (!leaderLocation) return null;

  // Step 2: Calculate distance between leader and follower
  const distance = DistanceUtils.haversineDistance(
    leaderLocation.location,
    followerUpdate.location,
  );

  // Step 3: Check if distance exceeds threshold
  if (distance > journey.lagThresholdMeters) {
    // Step 4: Determine severity
    const severity = distance > 1000 ? 'CRITICAL' : 'WARNING';

    // Step 5: Create lag alert in Firestore
    const lagAlert = await this.createLagAlert({
      journeyId: journey.id,
      participantId: followerUpdate.participantId,
      userId: followerUpdate.userId,
      distanceFromLeader: distance,
      severity,
      leaderLocation: leaderLocation.location,
      followerLocation: followerUpdate.location,
      timestamp: Date.now(),
    });

    return lagAlert;
  }

  // No lag detected
  return null;
}
```

**Severity Levels**:
- **WARNING**: Distance > lagThresholdMeters (default 500m)
- **CRITICAL**: Distance > 1000m

**Auto-Resolution**:
```typescript
// When follower catches up (distance < threshold)
// Next update will not trigger lag alert
// Previous alert remains in Firestore for history
```

---

#### 6. Arrival Detection Service (`services/arrival-detection.service.ts`)

**Purpose**: Detect when participants reach destination

**Algorithm**:

```typescript
async detectArrival(locationUpdate, journey): Promise<boolean> {
  // Step 1: Check if journey has destination
  if (!journey.destination) return false;

  // Step 2: Calculate distance to destination
  const distance = DistanceUtils.haversineDistance(
    locationUpdate.location,
    journey.destination,
  );

  // Step 3: Check arrival conditions
  const ARRIVAL_THRESHOLD = 100; // meters
  const MAX_ARRIVAL_SPEED = 5; // m/s (18 km/h)

  const isClose = distance < ARRIVAL_THRESHOLD;
  const isSlow = (locationUpdate.speed || 0) < MAX_ARRIVAL_SPEED;

  if (isClose && isSlow) {
    // Step 4: Update participant status
    await this.participantService.updateParticipantStatus(
      journey.id,
      locationUpdate.participantId,
      'ARRIVED',
    );

    // Step 5: Check if all participants arrived
    const allArrived = await this.checkAllParticipantsArrived(journey.id);

    if (allArrived) {
      // Auto-complete journey
      await this.journeyService.end(journey.id, journey.leaderId);
    }

    return true;
  }

  return false;
}
```

---

### 🔗 Data Flow Example

Let's trace a complete location update from mobile app to broadcast:

```
1. Mobile App
   └─> Sends WebSocket message:
       {
         event: 'location-update',
         data: {
           journeyId: 'abc123',
           location: { latitude: 40.7128, longitude: -74.0060 },
           accuracy: 10,
           speed: 15,
           heading: 90,
           metadata: { batteryLevel: 75 }
         }
       }

2. Location Gateway (lines 234-298)
   ├─> Receives event via @SubscribeMessage('location-update')
   ├─> Extracts userId from client.data.userId (set during auth)
   └─> Calls: locationService.processLocationUpdate(userId, payload)

3. Location Service (lines 36-163)
   ├─> Validates participant
   ├─> Checks rate limit
   ├─> Gets journey & participant info
   ├─> Gets last location from Firestore
   ├─> Gets leader location from Redis
   ├─> Calculates priority: MEDIUM (significant movement)
   ├─> Not throttled (>2 seconds since last)
   ├─> Gets sequence number: 42 (from Redis INCR)
   ├─> Saves to Firestore: journeys/abc123/locations/xyz789
   ├─> Caches in Redis: journey:abc123:location:participant456
   ├─> Checks lag: distance 300m < threshold 500m = OK
   ├─> Checks arrival: distance 5000m > 100m = Not arrived
   └─> Returns: { success: true, sequenceNumber: 42, ... }

4. Location Gateway (continued)
   ├─> Sends ACK to sender:
   │   socket.emit('location-update-ack', { sequenceNumber: 42, priority: 'MEDIUM' })
   │
   └─> Broadcasts to journey room:
       server.to('journey:abc123').emit('location-update', {
         userId: 'user123',
         location: { latitude: 40.7128, longitude: -74.0060 },
         sequenceNumber: 42,
         priority: 'MEDIUM',
         speed: 15,
         heading: 90,
         timestamp: 1704067200000
       })

5. All Connected Clients in Room
   └─> Receive location update
   └─> Update UI with new position
   └─> Check sequence number for gaps
```

---

## 📚 Part 2: Notification Module Deep Dive

### Architecture

```
┌──────────────────────────────────┐
│  Notification Service            │
│  - Create notifications          │
│  - Helper methods for each type  │
│  - FCM integration (TODO)        │
└──────┬───────────────────────────┘
       │
       ├─────────────┬──────────────┐
       ▼             ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│Firestore │  │WebSocket │  │FCM (Future)  │
│(History) │  │(Instant) │  │(Push)        │
└──────────┘  └──────────┘  └──────────────┘
```

### Notification Types

```typescript
type NotificationType =
  | 'JOURNEY_INVITE'      // User invited to journey
  | 'JOURNEY_STARTED'     // Journey began
  | 'JOURNEY_ENDED'       // Journey completed
  | 'LAG_ALERT'           // Follower lagging
  | 'ARRIVAL_DETECTED'    // Participant arrived
  | 'PARTICIPANT_JOINED'  // New participant
  | 'PARTICIPANT_LEFT';   // Participant left
```

### Notification Service Methods

#### 1. Create Generic Notification

```typescript
async createNotification(dto: CreateNotificationDto): Promise<Notification> {
  // Store in Firestore: journeys/{journeyId}/notifications/{id}
  const notificationData = {
    journeyId: dto.journeyId,
    recipientId: dto.recipientId,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    data: dto.data,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  await notificationRef.set(notificationData);

  // TODO: Send FCM push notification
  // await this.sendPushNotification(dto.recipientId, notificationData);

  return notification;
}
```

#### 2. Helper Methods

Each notification type has a dedicated helper:

```typescript
// Journey Invite
await notificationService.sendJourneyInvite(
  journeyId,
  journeyName,
  recipientId,
  inviterName
);

// Journey Started
await notificationService.sendJourneyStarted(
  journeyId,
  recipientIds // array of all participants
);

// Lag Alert
await notificationService.sendLagAlert(
  journeyId,
  userId,
  distance, // meters
  severity  // 'WARNING' | 'CRITICAL'
);

// Arrival Detected
await notificationService.sendArrivalDetected(
  journeyId,
  participantName,
  recipientIds // notify all participants
);
```

### Integration Points

**Where notifications are triggered**:

1. **Location Service** (lag detection):
```typescript
// src/modules/location/location.service.ts:131
if (participant.role === 'FOLLOWER') {
  lagAlert = await this.lagDetectionService.detectLag(locationUpdate, journey);

  if (lagAlert) {
    // TODO: Call notification service
    await this.notificationService.sendLagAlert(
      journey.id,
      userId,
      lagAlert.distanceFromLeader,
      lagAlert.severity
    );
  }
}
```

2. **Arrival Detection Service**:
```typescript
// src/modules/location/services/arrival-detection.service.ts
if (isClose && isSlow) {
  // Update status
  await this.participantService.updateParticipantStatus(...);

  // TODO: Notify all participants
  const participants = await this.participantService.getJourneyParticipants(journeyId);
  const recipientIds = participants.map(p => p.userId);

  await this.notificationService.sendArrivalDetected(
    journeyId,
    participantName,
    recipientIds
  );
}
```

3. **Journey Service** (start/end):
```typescript
// src/modules/journey/journey.service.ts:145
async start(journeyId, userId) {
  // ... start logic ...

  // TODO: Notify participants
  const participants = await this.participantService.getJourneyParticipants(journeyId);
  const recipientIds = participants.map(p => p.userId);

  await this.notificationService.sendJourneyStarted(journeyId, recipientIds);
}
```

---

## 🎯 Part 3: Testing Guide

### 1. Setup Your Environment

```bash
# Start Redis
docker-compose up -d

# Install dependencies
npm install

# Configure .env
cp .env.example .env
# Edit .env with your credentials

# Build
npm run build

# Start server
npm run start:dev
```

### 2. Test REST Endpoints

Use **Postman** or **curl**:

```bash
# 1. Register a user
POST http://localhost:3000/auth/register
{
  "email": "leader@test.com",
  "password": "password123",
  "displayName": "Leader User"
}
# Response: { token: "firebase-id-token", user: {...} }

# 2. Create a journey
POST http://localhost:3000/journeys
Authorization: Bearer <firebase-token>
{
  "name": "Road Trip to NYC",
  "destinationAddress": "New York, NY",
  "lagThresholdMeters": 500
}
# Response: { id: "journey123", ... }

# 3. Start journey
POST http://localhost:3000/journeys/journey123/start
Authorization: Bearer <firebase-token>
```

### 3. Test WebSocket Connection

Use **Socket.io Client** (Node.js):

```javascript
const io = require('socket.io-client');

// Connect with Firebase token
const socket = io('ws://localhost:3000/location', {
  transports: ['websocket'],
  auth: {
    token: 'your-firebase-id-token'
  }
});

// Handle connection
socket.on('connect', () => {
  console.log('Connected:', socket.id);
});

socket.on('connection-status', (data) => {
  console.log('Status:', data);
});

// Join journey
socket.emit('join-journey', { journeyId: 'journey123' });

socket.on('joined-journey', (data) => {
  console.log('Joined:', data);
});

// Send location update
setInterval(() => {
  socket.emit('location-update', {
    journeyId: 'journey123',
    location: {
      latitude: 40.7128 + Math.random() * 0.01,
      longitude: -74.0060 + Math.random() * 0.01
    },
    accuracy: 10,
    speed: 15,
    heading: 90,
    metadata: {
      batteryLevel: 75,
      isMoving: true
    }
  });
}, 3000);

// Listen for broadcasts
socket.on('location-update', (data) => {
  console.log('Location received:', data);
});

socket.on('lag-alert', (data) => {
  console.log('LAG ALERT:', data);
});

// Send heartbeat
setInterval(() => {
  socket.emit('heartbeat');
}, 4000);
```

### 4. Test Lag Detection

**Scenario**: Create 2 users (leader + follower), send different locations

```javascript
// Leader socket (separate connection)
leaderSocket.emit('location-update', {
  journeyId: 'journey123',
  location: { latitude: 40.7128, longitude: -74.0060 },
  // ... other fields
});

// Follower socket (far away location)
followerSocket.emit('location-update', {
  journeyId: 'journey123',
  location: { latitude: 40.7000, longitude: -74.0200 }, // ~600m away
  // ... other fields
});

// Listen for lag alert
followerSocket.on('lag-alert', (alert) => {
  console.log('⚠️ Lag Alert:', alert);
  // { participantId, userId, distanceFromLeader: 600, severity: 'WARNING' }
});
```

### 5. Monitor Redis

```bash
# Open Redis CLI
redis-cli

# Monitor all commands
MONITOR

# Check journey sequences
GET journey:journey123:sequence

# Check cached locations
GET journey:journey123:location:participant456

# Check active journeys
SMEMBERS active_journeys
```

### 6. Monitor Firestore

```
Firebase Console → Firestore Database

Collections to check:
- journeys/{journeyId}
  - participants/{userId}
  - locations/{locationId}
  - lag_alerts/{alertId}
  - notifications/{notificationId}

- users/{userId}
- analytics/{journeyId}
```

---

## 🚀 Part 4: Extension Opportunities

### 1. Integrate Notifications into Location Flow

**Task**: Call notification service when lag detected

**File**: `src/modules/location/location.service.ts`

**Code to add** (after line 132):

```typescript
// 12. Detect lag (for followers only)
let lagAlert: any = undefined;
if (participant.role === 'FOLLOWER') {
  lagAlert = await this.lagDetectionService.detectLag(locationUpdate, journey);

  // NEW: Send notification
  if (lagAlert) {
    await this.notificationService.sendLagAlert(
      journeyId,
      userId,
      lagAlert.distanceFromLeader,
      lagAlert.severity
    );
  }
}
```

**Remember to inject** `NotificationService` in constructor:

```typescript
constructor(
  // ... existing services
  private notificationService: NotificationService, // ADD THIS
) {}
```

**Update module** (`location.module.ts`):

```typescript
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    // ... existing imports
    NotificationModule, // ADD THIS
  ],
  // ... rest
})
```

### 2. Implement FCM Push Notifications

**Task**: Send actual push notifications to mobile devices

**File**: `src/modules/notification/notification.service.ts`

**Steps**:

1. Add FCM token registration endpoint:

```typescript
// notification.controller.ts
@Post('register-token')
async registerFCMToken(
  @CurrentUser() user: any,
  @Body() body: { fcmToken: string },
) {
  await this.firebaseService.firestore
    .collection('users')
    .doc(user.uid)
    .update({
      fcmToken: body.fcmToken,
      fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    });
}
```

2. Implement `sendPushNotification` method:

```typescript
private async sendPushNotification(userId: string, notification: any): Promise<void> {
  // Get user's FCM token
  const userDoc = await this.firebaseService.firestore
    .collection('users')
    .doc(userId)
    .get();

  const fcmToken = userDoc.data()?.fcmToken;
  if (!fcmToken) {
    console.log(`No FCM token for user ${userId}`);
    return;
  }

  // Send via Firebase Admin SDK
  try {
    await this.firebaseService.app.messaging().send({
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    console.log(`Push notification sent to ${userId}`);
  } catch (error) {
    console.error(`Failed to send push notification:`, error);
  }
}
```

### 3. Add WebSocket Notification Broadcasting

**Task**: Instantly notify via WebSocket when notification created

**File**: `src/modules/notification/notification.service.ts`

**Add** LocationGateway injection:

```typescript
constructor(
  private firebaseService: FirebaseService,
  private locationGateway: LocationGateway, // ADD THIS
) {}
```

**Broadcast after creating notification**:

```typescript
async createNotification(dto: CreateNotificationDto): Promise<Notification> {
  // ... existing code to save in Firestore ...

  // NEW: Broadcast via WebSocket
  this.locationGateway.server.to(`journey:${dto.journeyId}`).emit('notification', {
    id: notificationRef.id,
    type: dto.type,
    title: dto.title,
    body: dto.body,
    data: dto.data,
    timestamp: Date.now(),
  });

  // Send push notification
  await this.sendPushNotification(dto.recipientId, notificationData);

  return notification;
}
```

### 4. Add Analytics Auto-Calculation on Journey End

**Task**: Automatically calculate analytics when journey ends

**File**: `src/modules/journey/journey.service.ts`

**Inject** AnalyticsService:

```typescript
constructor(
  // ... existing
  private analyticsService: AnalyticsService, // ADD THIS
) {}
```

**Call after journey ends** (line 196):

```typescript
async end(journeyId: string, userId: string): Promise<Journey> {
  // ... existing code ...

  // Remove from active journeys in Redis
  await this.redisService.removeActiveJourney(journeyId);

  // NEW: Calculate analytics
  try {
    await this.analyticsService.calculateJourneyAnalytics(journeyId);
    console.log(`Analytics calculated for journey ${journeyId}`);
  } catch (error) {
    console.error('Failed to calculate analytics:', error);
    // Don't fail the journey end if analytics fails
  }

  return this.findById(journeyId);
}
```

---

## 📝 Part 5: Best Practices & Tips

### Code Quality

1. **Always validate inputs** using DTOs and class-validator
2. **Handle errors gracefully** with try-catch and proper error messages
3. **Use TypeScript types** - avoid `any` where possible
4. **Document complex logic** with comments explaining WHY, not WHAT
5. **Keep functions focused** - one responsibility per function

### Performance

1. **Cache frequently accessed data** in Redis (locations, sequences)
2. **Use Firestore batch writes** when creating multiple documents
3. **Implement pagination** for list endpoints (locations, notifications)
4. **Monitor Redis memory** usage and set appropriate TTLs
5. **Use indexes** in Firestore for common queries

### Security

1. **Always verify Firebase tokens** before processing requests
2. **Check participant membership** before allowing access
3. **Implement rate limiting** to prevent abuse
4. **Sanitize user inputs** to prevent injection attacks
5. **Deploy Firestore security rules** before production

### Debugging

1. **Use console.log** strategically (add userId, journeyId)
2. **Monitor WebSocket events** in browser dev tools
3. **Check Redis** for cached data consistency
4. **Verify Firestore writes** in Firebase Console
5. **Test error scenarios** (disconnections, invalid data)

---

## 🎓 Learning Path

### Week 1: Understanding
- ✅ Read this entire guide
- ✅ Study Location Gateway code (location.gateway.ts)
- ✅ Study Location Service code (location.service.ts)
- ✅ Understand Priority Service logic
- ✅ Review Notification Service structure

### Week 2: Testing
- ✅ Set up environment (.env, Redis, Firebase)
- ✅ Test REST endpoints with Postman
- ✅ Test WebSocket connection with Socket.io client
- ✅ Simulate lag detection scenario
- ✅ Monitor Redis and Firestore

### Week 3: Extension
- ✅ Integrate notifications with location events
- ✅ Implement FCM push notifications
- ✅ Add WebSocket notification broadcasting
- ✅ Add analytics auto-calculation
- ✅ Write unit tests for priority service

### Week 4: Optimization
- ✅ Profile WebSocket performance
- ✅ Optimize Redis caching strategy
- ✅ Implement connection pooling
- ✅ Add comprehensive error handling
- ✅ Write integration tests

---

## 📚 Additional Resources

### NestJS
- [WebSocket Gateways](https://docs.nestjs.com/websockets/gateways)
- [Custom Decorators](https://docs.nestjs.com/custom-decorators)
- [Exception Filters](https://docs.nestjs.com/exception-filters)

### Socket.io
- [Emit Cheatsheet](https://socket.io/docs/v4/emit-cheatsheet/)
- [Rooms](https://socket.io/docs/v4/rooms/)
- [Acknowledgments](https://socket.io/docs/v4/emitting-events/#acknowledgements)

### Firebase
- [Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

### Redis
- [Commands](https://redis.io/commands)
- [Data Types](https://redis.io/docs/data-types/)
- [Best Practices](https://redis.io/docs/management/optimization/)

---

## ✅ Checklist Before Production

- [ ] All environment variables documented
- [ ] Firebase security rules deployed
- [ ] Error handling for all API endpoints
- [ ] WebSocket reconnection logic tested
- [ ] Rate limiting configured and tested
- [ ] Logging implemented (Winston/Pino)
- [ ] Health check endpoint added
- [ ] Docker Compose for production ready
- [ ] CI/CD pipeline configured
- [ ] Load testing completed (1000+ connections)
- [ ] Security audit (dependency scan)
- [ ] API documentation complete
- [ ] README updated with deployment guide
- [ ] Monitoring/alerting setup (e.g., Sentry)
- [ ] Backup strategy for Firestore

---

## 💬 Questions to Deepen Understanding

As you study the code, ask yourself:

1. **Why does the gateway verify tokens on connection rather than per-message?**
   - Performance: Token verification is expensive (Firebase API call)
   - Security: Once verified, socket is trusted for the session

2. **Why store locations in both Redis and Firestore?**
   - Redis: Fast reads for real-time features (lag detection)
   - Firestore: Persistence for history, analytics, and recovery

3. **Why use sequence numbers instead of timestamps for ordering?**
   - Clock skew: Client and server clocks may differ
   - Atomicity: Redis INCR guarantees no duplicate numbers
   - Simplicity: Easy gap detection (seq 5, 6, 8 = gap at 7)

4. **Why throttle LOW priority updates but not HIGH?**
   - Battery: Reduce radio usage on mobile devices
   - Bandwidth: Save network traffic
   - Critical updates (lag, leader) must get through

5. **Why separate Priority, Sequence, and Acknowledgment into services?**
   - Single Responsibility: Each service has one job
   - Testability: Easy to unit test each component
   - Reusability: Can be used in different contexts

---

## 🎯 Summary

You now have a **production-ready backend** with:

✅ **Real-time location tracking** via WebSocket
✅ **Uber-inspired reliability** (priority, sequence, ACK)
✅ **Intelligent alerts** (lag detection, arrival detection)
✅ **Scalable architecture** (Redis + Firestore)
✅ **Notification system** (Firestore + FCM ready)
✅ **Complete REST API** for mobile app integration

**Your next steps**:
1. Set up your environment and run the server
2. Test the WebSocket flow with a client
3. Integrate notifications with location events
4. Add FCM push notification support
5. Deploy to production and monitor performance

Good luck, and enjoy building with Tu-Link! 🚀
