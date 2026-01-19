# Journey Invitation Flow

## Overview

The journey invitation system allows leaders to invite users to join their journeys. This document explains the complete invitation flow, from sending invitations to accepting/declining them.

## Complete Invitation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Journey Invitation Flow                       │
└─────────────────────────────────────────────────────────────────┘

1. Leader creates journey
   └─► Status: PENDING
       Leader auto-joins as participant (status: ACTIVE)

2. Leader invites follower
   POST /journeys/{id}/invite
   └─► Participant created (status: INVITED)
       Notification created in /notifications collection
       └─► Type: JOURNEY_INVITATION
           Title: "Journey Invitation"
           Message: "{inviterName} invited you to join '{journeyName}'"

3. Follower receives notification
   GET /journeys/invitations
   └─► Returns list of pending invitations with:
       - Journey details
       - Inviter information
       - Invitation timestamp

4. Follower accepts/declines
   ┌─► POST /journeys/{id}/accept
   │   └─► Participant status: INVITED → ACCEPTED
   │       joinedAt timestamp set
   │
   └─► POST /journeys/{id}/decline
       └─► Participant status: INVITED → DECLINED

5. Leader starts journey
   POST /journeys/{id}/start
   └─► Journey status: PENDING → ACTIVE
       All ACCEPTED participants → ACTIVE
```

## API Endpoints

### 1. Invite Participant

**Endpoint:** `POST /journeys/:id/invite`

**Who can use:** Journey leader only

**Request:**
```json
{
  "invitedUserId": "N8BPeJvNBMZIdjGMVpMOhxBH5f13"
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "message": "Invitation sent successfully"
  }
}
```

**What Happens:**
1. Creates participant document with `status: "INVITED"`
2. Creates notification in `/notifications` collection
3. Invited user can now see the invitation

---

### 2. Get Pending Invitations

**Endpoint:** `GET /journeys/invitations`

**Who can use:** Any authenticated user

**Request:** None (uses auth token)

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "journeyId": "czTzTNpG0cFsDrycoAhU",
      "journeyName": "Road Trip to Nairobi",
      "destination": "Nairobi, Kenya",
      "invitedBy": {
        "uid": "abc123",
        "displayName": "John Doe",
        "email": "leader@test.com"
      },
      "invitedAt": "2026-01-19T08:30:00.000Z"
    }
  ]
}
```

**Empty Invitations:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": []
}
```

---

### 3. Accept Invitation

**Endpoint:** `POST /journeys/:id/accept`

**Who can use:** Invited user only

**Request:** None

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "message": "Invitation accepted"
  }
}
```

**What Happens:**
1. Participant status: `INVITED` → `ACCEPTED`
2. `joinedAt` timestamp is set
3. User can now see journey in active journeys (once leader starts it)

---

### 4. Decline Invitation

**Endpoint:** `POST /journeys/:id/decline`

**Who can use:** Invited user only

**Request:** None

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "message": "Invitation declined"
  }
}
```

**What Happens:**
1. Participant status: `INVITED` → `DECLINED`
2. Invitation removed from pending list
3. User won't be part of the journey

## Firestore Structure

### Participant Document

**Path:** `/journeys/{journeyId}/participants/{userId}`

**States:**

**INVITED (initial):**
```javascript
{
  userId: "N8BPeJvNBMZIdjGMVpMOhxBH5f13",
  journeyId: "czTzTNpG0cFsDrycoAhU",
  role: "FOLLOWER",
  status: "INVITED",
  invitedBy: "leaderUserId",
  connectionStatus: "DISCONNECTED"
  // No joinedAt yet
}
```

**ACCEPTED:**
```javascript
{
  userId: "N8BPeJvNBMZIdjGMVpMOhxBH5f13",
  journeyId: "czTzTNpG0cFsDrycoAhU",
  role: "FOLLOWER",
  status: "ACCEPTED",
  invitedBy: "leaderUserId",
  connectionStatus: "DISCONNECTED",
  joinedAt: "2026-01-19T08:35:00.000Z"  // ✅ Set when accepted
}
```

**DECLINED:**
```javascript
{
  userId: "N8BPeJvNBMZIdjGMVpMOhxBH5f13",
  journeyId: "czTzTNpG0cFsDrycoAhU",
  role: "FOLLOWER",
  status: "DECLINED",
  invitedBy: "leaderUserId",
  connectionStatus: "DISCONNECTED"
}
```

### Notification Document

**Path:** `/notifications/{notificationId}`

```javascript
{
  userId: "N8BPeJvNBMZIdjGMVpMOhxBH5f13",
  type: "JOURNEY_INVITATION",
  title: "Journey Invitation",
  message: "John Doe invited you to join 'Road Trip to Nairobi'",
  data: {
    journeyId: "czTzTNpG0cFsDrycoAhU",
    inviterId: "abc123",
    journeyName: "Road Trip to Nairobi"
  },
  read: false,
  createdAt: "2026-01-19T08:30:00.000Z"
}
```

## How Users Receive Invitations

### Option 1: Poll for Invitations (Current Implementation)

The invited user periodically checks for pending invitations:

```typescript
// Mobile app polls every 30 seconds or on app open
const checkInvitations = async () => {
  const response = await fetch('http://localhost:3000/journeys/invitations', {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });

  const { data: invitations } = await response.json();

  if (invitations.length > 0) {
    showInvitationNotification(invitations);
  }
};

// Check on app open
checkInvitations();

// Check periodically
setInterval(checkInvitations, 30000);
```

### Option 2: Firestore Listener (Real-time)

The mobile app can listen to the notifications collection:

```typescript
// Set up real-time listener
const unsubscribe = firestore()
  .collection('notifications')
  .where('userId', '==', currentUserId)
  .where('read', '==', false)
  .where('type', '==', 'JOURNEY_INVITATION')
  .onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const notification = change.doc.data();
        showPushNotification(notification);
      }
    });
  });
```

### Option 3: Push Notifications (Recommended for Production)

For production, implement Firebase Cloud Messaging (FCM):

```typescript
// In cloud function (trigger on notification creation)
exports.sendInvitationPush = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snapshot, context) => {
    const notification = snapshot.data();

    if (notification.type === 'JOURNEY_INVITATION') {
      // Get user's FCM token
      const userDoc = await admin.firestore()
        .collection('users')
        .doc(notification.userId)
        .get();

      const fcmToken = userDoc.data()?.fcmToken;

      if (fcmToken) {
        await admin.messaging().send({
          token: fcmToken,
          notification: {
            title: notification.title,
            body: notification.message,
          },
          data: notification.data,
        });
      }
    }
  });
```

## Complete User Journey Example

### Scenario: Alice invites Bob to a journey

**1. Alice (Leader) creates journey:**
```bash
curl -X POST http://localhost:3000/journeys \
  -H "Authorization: Bearer ALICE_TOKEN" \
  -d '{
    "name": "Road Trip to Nairobi",
    "destinationAddress": "Nairobi, Kenya"
  }'
```

**2. Alice invites Bob:**
```bash
curl -X POST http://localhost:3000/journeys/journey123/invite \
  -H "Authorization: Bearer ALICE_TOKEN" \
  -d '{
    "invitedUserId": "BOB_USER_ID"
  }'
```

**3. Bob checks invitations:**
```bash
curl -X GET http://localhost:3000/journeys/invitations \
  -H "Authorization: Bearer BOB_TOKEN"

# Response:
{
  "data": [{
    "journeyId": "journey123",
    "journeyName": "Road Trip to Nairobi",
    "destination": "Nairobi, Kenya",
    "invitedBy": {
      "uid": "ALICE_USER_ID",
      "displayName": "Alice Smith",
      "email": "alice@test.com"
    },
    "invitedAt": "2026-01-19T08:30:00.000Z"
  }]
}
```

**4. Bob accepts invitation:**
```bash
curl -X POST http://localhost:3000/journeys/journey123/accept \
  -H "Authorization: Bearer BOB_TOKEN"
```

**5. Alice starts journey:**
```bash
curl -X POST http://localhost:3000/journeys/journey123/start \
  -H "Authorization: Bearer ALICE_TOKEN"
```

**6. Bob sees journey in active journeys:**
```bash
curl -X GET http://localhost:3000/journeys/active \
  -H "Authorization: Bearer BOB_TOKEN"

# Response includes the journey
```

## Participant Status States

```
INVITED ────► ACCEPTED ────► ACTIVE ────► LEFT
   │                           │
   │                           └────► COMPLETED
   │
   └────────► DECLINED
```

| Status | Meaning | Can transition to |
|--------|---------|-------------------|
| `INVITED` | User received invitation | `ACCEPTED`, `DECLINED` |
| `ACCEPTED` | User accepted, waiting for journey start | `ACTIVE`, `LEFT` |
| `ACTIVE` | Journey started, user is active | `LEFT`, `COMPLETED` |
| `DECLINED` | User declined invitation | (terminal state) |
| `LEFT` | User left mid-journey | (terminal state) |
| `COMPLETED` | Journey ended normally | (terminal state) |

## Testing the Invitation Flow

### Full Flow Test

```bash
# 1. Register leader
LEADER_TOKEN=$(curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"leader@test.com","password":"password123","displayName":"Leader User"}' \
  | jq -r '.data.tokens.idToken')

# 2. Register follower
FOLLOWER_TOKEN=$(curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"follower@test.com","password":"password123","displayName":"Follower User"}' \
  | jq -r '.data.tokens.idToken')

FOLLOWER_ID=$(curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer $FOLLOWER_TOKEN" \
  | jq -r '.data.id')

# 3. Leader creates journey
JOURNEY_ID=$(curl -X POST http://localhost:3000/journeys \
  -H "Authorization: Bearer $LEADER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Journey","destinationAddress":"Nairobi"}' \
  | jq -r '.data.id')

# 4. Leader invites follower
curl -X POST http://localhost:3000/journeys/$JOURNEY_ID/invite \
  -H "Authorization: Bearer $LEADER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"invitedUserId\":\"$FOLLOWER_ID\"}"

# 5. Follower checks invitations
curl -X GET http://localhost:3000/journeys/invitations \
  -H "Authorization: Bearer $FOLLOWER_TOKEN" | jq

# 6. Follower accepts
curl -X POST http://localhost:3000/journeys/$JOURNEY_ID/accept \
  -H "Authorization: Bearer $FOLLOWER_TOKEN"

# 7. Leader starts journey
curl -X POST http://localhost:3000/journeys/$JOURNEY_ID/start \
  -H "Authorization: Bearer $LEADER_TOKEN"

# 8. Both users see active journey
curl -X GET http://localhost:3000/journeys/active \
  -H "Authorization: Bearer $FOLLOWER_TOKEN" | jq
```

## Summary

✅ **Invitation Created:** Participant + Notification documents
✅ **User Discovery:** `GET /journeys/invitations` endpoint
✅ **Notification System:** Firestore notifications collection
✅ **Accept/Decline:** Standard workflow endpoints
✅ **Status Tracking:** Complete participant lifecycle
✅ **Real-time Ready:** Can add Firestore listeners or FCM

**Key Points:**
- Invitations are stored in participant documents with `status: "INVITED"`
- Notifications are created for real-time discovery
- Users can poll or listen for invitations
- Complete accept/decline workflow implemented
- Ready for push notification integration
