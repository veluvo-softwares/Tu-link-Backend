# Postman Testing Guide

## 📦 Quick Setup

### 1. Import Collection

1. Open Postman
2. Click **Import** button
3. Select `Tu-Link-Backend.postman_collection.json` from the project root
4. Collection will appear in your sidebar

### 2. Configure Environment

The collection uses variables that are automatically set during testing:

**Variables (Auto-populated)**:
- `baseUrl` - Default: `http://localhost:3000`
- `authToken` - Auto-saved from register/login
- `userId` - Auto-saved from register
- `journeyId` - Auto-saved from create journey
- `follower1Token` - Auto-saved from follower 1 registration
- `follower1Id` - Auto-saved from follower 1 registration
- `follower2Token` - Auto-saved from follower 2 registration
- `follower2Id` - Auto-saved from follower 2 registration

**Optional**: Create a Postman Environment for different setups (local, staging, production)

---

## 🚀 Complete Testing Flow

### Phase 1: User Registration

#### Step 1: Register Leader
```
POST {{baseUrl}}/auth/register

Body:
{
  "email": "leader@test.com",
  "password": "password123",
  "displayName": "Leader User",
  "phoneNumber": "+1234567890"
}

Expected Response (201):
{
  "user": {
    "id": "user_abc123",
    "email": "leader@test.com",
    "displayName": "Leader User",
    "phoneNumber": "+1234567890"
  },
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}

✅ Auto-saved variables:
- authToken
- userId
```

#### Step 2: Register Follower 1
```
POST {{baseUrl}}/auth/register

Body:
{
  "email": "follower1@test.com",
  "password": "password123",
  "displayName": "Follower One",
  "phoneNumber": "+1234567891"
}

✅ Auto-saved variables:
- follower1Token
- follower1Id
```

#### Step 3: Register Follower 2
```
POST {{baseUrl}}/auth/register

Body:
{
  "email": "follower2@test.com",
  "password": "password123",
  "displayName": "Follower Two",
  "phoneNumber": "+1234567892"
}

✅ Auto-saved variables:
- follower2Token
- follower2Id
```

---

### Phase 2: Journey Management

#### Step 4: Create Journey (as Leader)
```
POST {{baseUrl}}/journeys
Authorization: Bearer {{authToken}}

Body:
{
  "name": "Road Trip to NYC",
  "destination": {
    "latitude": 40.7128,
    "longitude": -74.0060
  },
  "destinationAddress": "New York, NY, USA",
  "lagThresholdMeters": 500
}

Expected Response (201):
{
  "id": "journey_xyz789",
  "name": "Road Trip to NYC",
  "leaderId": "user_abc123",
  "status": "PENDING",
  "destination": {
    "latitude": 40.7128,
    "longitude": -74.0060
  },
  "destinationAddress": "New York, NY, USA",
  "lagThresholdMeters": 500,
  "createdAt": {...},
  "updatedAt": {...}
}

✅ Auto-saved variable:
- journeyId
```

#### Step 5: Invite Follower 1
```
POST {{baseUrl}}/journeys/{{journeyId}}/invite
Authorization: Bearer {{authToken}}

Body:
{
  "invitedUserId": "{{follower1Id}}"
}

Expected Response (201):
{
  "message": "Invitation sent successfully"
}
```

#### Step 6: Invite Follower 2
```
POST {{baseUrl}}/journeys/{{journeyId}}/invite
Authorization: Bearer {{authToken}}

Body:
{
  "invitedUserId": "{{follower2Id}}"
}
```

#### Step 7: Follower 1 Accepts Invitation
```
POST {{baseUrl}}/journeys/{{journeyId}}/accept
Authorization: Bearer {{follower1Token}}  ⚠️ Note: Use follower1Token

Expected Response (200):
{
  "message": "Invitation accepted"
}
```

**How to use follower token**:
1. In Postman, go to the request
2. Click **Authorization** tab
3. Select **Bearer Token**
4. Enter `{{follower1Token}}` in the token field

#### Step 8: Follower 2 Accepts Invitation
```
POST {{baseUrl}}/journeys/{{journeyId}}/accept
Authorization: Bearer {{follower2Token}}  ⚠️ Note: Use follower2Token
```

#### Step 9: View Journey Details
```
GET {{baseUrl}}/journeys/{{journeyId}}
Authorization: Bearer {{authToken}}

Expected Response (200):
{
  "id": "journey_xyz789",
  "name": "Road Trip to NYC",
  "leaderId": "user_abc123",
  "status": "PENDING",
  "participants": [
    {
      "userId": "user_abc123",
      "role": "LEADER",
      "status": "ACCEPTED"
    },
    {
      "userId": "follower1_id",
      "role": "FOLLOWER",
      "status": "ACCEPTED"
    },
    {
      "userId": "follower2_id",
      "role": "FOLLOWER",
      "status": "ACCEPTED"
    }
  ],
  ...
}
```

#### Step 10: Start Journey (as Leader)
```
POST {{baseUrl}}/journeys/{{journeyId}}/start
Authorization: Bearer {{authToken}}

Expected Response (200):
{
  "id": "journey_xyz789",
  "status": "ACTIVE",  ✅ Changed from PENDING
  "startTime": {...},
  ...
}
```

---

### Phase 3: Location Updates

#### Step 11: Send Location Update (Leader)
```
POST {{baseUrl}}/locations
Authorization: Bearer {{authToken}}

Body:
{
  "journeyId": "{{journeyId}}",
  "location": {
    "latitude": 40.7589,
    "longitude": -73.9851
  },
  "accuracy": 10.5,
  "altitude": 50.0,
  "heading": 90.0,
  "speed": 15.5,
  "metadata": {
    "batteryLevel": 75,
    "isMoving": true
  }
}

Expected Response (201):
{
  "success": true,
  "sequenceNumber": 1,
  "priority": "HIGH",
  "shouldBroadcast": true
}
```

#### Step 12: Send Location Update (Follower 1 - Close to Leader)
```
POST {{baseUrl}}/locations
Authorization: Bearer {{follower1Token}}

Body:
{
  "journeyId": "{{journeyId}}",
  "location": {
    "latitude": 40.7580,  // Close to leader
    "longitude": -73.9860
  },
  "accuracy": 10.5,
  "speed": 14.0,
  "heading": 90.0,
  "metadata": {
    "batteryLevel": 80,
    "isMoving": true
  }
}

Expected Response (201):
{
  "success": true,
  "sequenceNumber": 2,
  "priority": "MEDIUM",
  "shouldBroadcast": true,
  "lagAlert": null  // No lag detected (within 500m)
}
```

#### Step 13: Send Location Update (Follower 2 - Lagging Behind)
```
POST {{baseUrl}}/locations
Authorization: Bearer {{follower2Token}}

Body:
{
  "journeyId": "{{journeyId}}",
  "location": {
    "latitude": 40.7500,  // Far from leader (~600m)
    "longitude": -73.9900
  },
  "accuracy": 10.5,
  "speed": 10.0,
  "heading": 90.0,
  "metadata": {
    "batteryLevel": 70,
    "isMoving": true
  }
}

Expected Response (201):
{
  "success": true,
  "sequenceNumber": 3,
  "priority": "HIGH",  // HIGH due to lag alert
  "shouldBroadcast": true,
  "lagAlert": {
    "participantId": "follower2_participant_id",
    "userId": "follower2_id",
    "distanceFromLeader": 600,  // meters
    "severity": "WARNING"  // > 500m threshold
  }
}
```

#### Step 14: Get Latest Locations
```
GET {{baseUrl}}/locations/journeys/{{journeyId}}/latest
Authorization: Bearer {{authToken}}

Expected Response (200):
{
  "leader_participant_id": {
    "journeyId": "journey_xyz789",
    "participantId": "leader_participant_id",
    "userId": "user_abc123",
    "location": {
      "latitude": 40.7589,
      "longitude": -73.9851
    },
    "speed": 15.5,
    "sequenceNumber": 1,
    "priority": "HIGH",
    "timestamp": 1704067200000
  },
  "follower1_participant_id": {
    "location": {
      "latitude": 40.7580,
      "longitude": -73.9860
    },
    ...
  },
  "follower2_participant_id": {
    "location": {
      "latitude": 40.7500,
      "longitude": -73.9900
    },
    ...
  }
}
```

#### Step 15: Get Location History
```
GET {{baseUrl}}/locations/journeys/{{journeyId}}/history?limit=100
Authorization: Bearer {{authToken}}

Expected Response (200):
[
  {
    "id": "location_3",
    "journeyId": "journey_xyz789",
    "participantId": "follower2_participant_id",
    "location": {
      "latitude": 40.7500,
      "longitude": -73.9900
    },
    "sequenceNumber": 3,
    "timestamp": {...}
  },
  {
    "id": "location_2",
    "journeyId": "journey_xyz789",
    "participantId": "follower1_participant_id",
    "location": {
      "latitude": 40.7580,
      "longitude": -73.9860
    },
    "sequenceNumber": 2,
    "timestamp": {...}
  },
  {
    "id": "location_1",
    "journeyId": "journey_xyz789",
    "participantId": "leader_participant_id",
    "location": {
      "latitude": 40.7589,
      "longitude": -73.9851
    },
    "sequenceNumber": 1,
    "timestamp": {...}
  }
]
```

---

### Phase 4: Notifications

#### Step 16: Get Notifications (Follower 2)
```
GET {{baseUrl}}/notifications?limit=50
Authorization: Bearer {{follower2Token}}

Expected Response (200):
[
  {
    "id": "notification_1",
    "journeyId": "journey_xyz789",
    "recipientId": "follower2_id",
    "type": "LAG_ALERT",
    "title": "Lag Warning",
    "body": "You are 600m behind the leader",
    "data": {
      "distance": 600,
      "severity": "WARNING"
    },
    "read": false,
    "createdAt": {...}
  },
  {
    "id": "notification_2",
    "journeyId": "journey_xyz789",
    "recipientId": "follower2_id",
    "type": "JOURNEY_INVITE",
    "title": "Journey Invitation",
    "body": "Leader User invited you to join \"Road Trip to NYC\"",
    "read": true,
    "createdAt": {...}
  }
]
```

#### Step 17: Get Unread Count
```
GET {{baseUrl}}/notifications/unread-count
Authorization: Bearer {{follower2Token}}

Expected Response (200):
{
  "count": 1
}
```

#### Step 18: Mark Notification as Read
```
PUT {{baseUrl}}/notifications/{{journeyId}}/notification_1/read
Authorization: Bearer {{follower2Token}}

Expected Response (200):
{
  "message": "Notification marked as read"
}
```

---

### Phase 5: Maps API

#### Step 19: Geocode Address
```
POST {{baseUrl}}/maps/geocode
Authorization: Bearer {{authToken}}

Body:
{
  "address": "Times Square, New York, NY"
}

Expected Response (200):
{
  "latitude": 40.7589,
  "longitude": -73.9851,
  "formattedAddress": "Times Square, Manhattan, NY 10036, USA"
}
```

#### Step 20: Reverse Geocode
```
POST {{baseUrl}}/maps/reverse-geocode
Authorization: Bearer {{authToken}}

Body:
{
  "latitude": 40.7589,
  "longitude": -73.9851
}

Expected Response (200):
{
  "address": "W 47th St, New York, NY 10036, USA"
}
```

#### Step 21: Calculate Distance
```
POST {{baseUrl}}/maps/distance
Authorization: Bearer {{authToken}}

Body:
{
  "origin": {
    "latitude": 40.7589,
    "longitude": -73.9851
  },
  "destination": {
    "latitude": 40.7128,
    "longitude": -74.0060
  }
}

Expected Response (200):
{
  "distance": 5280,  // meters (Haversine)
  "routeDistance": 5500,  // meters (actual route)
  "duration": 660  // seconds (11 minutes)
}
```

---

### Phase 6: Analytics

#### Step 22: End Journey (as Leader)
```
POST {{baseUrl}}/journeys/{{journeyId}}/end
Authorization: Bearer {{authToken}}

Expected Response (200):
{
  "id": "journey_xyz789",
  "status": "COMPLETED",  ✅ Changed from ACTIVE
  "endTime": {...},
  ...
}
```

#### Step 23: Get Journey Analytics
```
GET {{baseUrl}}/analytics/journeys/{{journeyId}}
Authorization: Bearer {{authToken}}

Expected Response (200):
{
  "id": "journey_xyz789",
  "journeyId": "journey_xyz789",
  "startTime": {...},
  "endTime": {...},
  "totalDuration": 3600,  // seconds (1 hour)
  "totalDistance": 15000,  // meters (15 km)
  "averageSpeed": 4.17,  // m/s (~15 km/h)
  "maxLagDistance": 600,  // meters
  "lagAlertCount": 1,
  "participantCount": 3,
  "stats": {
    "leaderStops": 2,
    "avgFollowerLag": 0,
    "connectionDrops": 0
  },
  "routePolyline": "[{\"lat\":40.7589,\"lng\":-73.9851}...]"
}
```

#### Step 24: Get User Journey History
```
GET {{baseUrl}}/analytics/user?limit=20
Authorization: Bearer {{authToken}}

Expected Response (200):
[
  {
    "id": "journey_xyz789",
    "name": "Road Trip to NYC",
    "status": "COMPLETED",
    "createdAt": {...},
    "analytics": {
      "totalDistance": 15000,
      "averageSpeed": 4.17,
      "lagAlertCount": 1,
      ...
    }
  },
  {
    "id": "journey_abc123",
    "name": "Previous Journey",
    "status": "COMPLETED",
    ...
  }
]
```

---

## 🧪 Testing Scenarios

### Scenario 1: Priority Calculation

**Test HIGH Priority (Leader Update)**
```
POST {{baseUrl}}/locations
Authorization: Bearer {{authToken}}  // Leader

Body:
{
  "journeyId": "{{journeyId}}",
  "location": {
    "latitude": 40.7600,
    "longitude": -73.9800
  },
  ...
}

Expected: priority: "HIGH"
Reason: All leader updates are HIGH priority
```

**Test MEDIUM Priority (Significant Movement)**
```
POST {{baseUrl}}/locations
Authorization: Bearer {{follower1Token}}

Body:
{
  "journeyId": "{{journeyId}}",
  "location": {
    "latitude": 40.7650,  // Moved >50 meters
    "longitude": -73.9750
  },
  ...
}

Expected: priority: "MEDIUM"
Reason: Significant movement detected
```

**Test LOW Priority (Minor Update)**
```
POST {{baseUrl}}/locations
Authorization: Bearer {{follower1Token}}

Body:
{
  "journeyId": "{{journeyId}}",
  "location": {
    "latitude": 40.7651,  // Moved <50 meters
    "longitude": -73.9751
  },
  "speed": 14.0,  // No significant speed change
  ...
}

Expected: priority: "LOW"
Reason: Minor position change
```

---

### Scenario 2: Lag Detection

**Test WARNING Severity (500-1000m)**
```
Leader location: 40.7589, -73.9851
Follower location: 40.7500, -73.9900  // ~600m away

Expected lag alert:
{
  "distanceFromLeader": 600,
  "severity": "WARNING"
}
```

**Test CRITICAL Severity (>1000m)**
```
Leader location: 40.7589, -73.9851
Follower location: 40.7400, -73.9950  // ~1100m away

Expected lag alert:
{
  "distanceFromLeader": 1100,
  "severity": "CRITICAL"
}
```

---

### Scenario 3: Rate Limiting

**Test Rate Limit (60 requests/min)**

Send 61 location updates in quick succession:
```javascript
// Use Postman Runner or script
for (let i = 0; i < 61; i++) {
  POST {{baseUrl}}/locations
  // ... same body
}

Expected:
- First 60 requests: 201 Created
- 61st request: 400 Bad Request "Rate limit exceeded"
```

---

### Scenario 4: Throttling

**Test Time-Based Throttling**
```
1. Send location update (priority: LOW)
   Response: success: true

2. Immediately send another (within 5 seconds)
   Response: success: false (throttled)

3. Wait 5+ seconds, send again
   Response: success: true
```

**Test Battery-Aware Throttling**
```
Send location with low battery:
{
  "location": {...},
  "metadata": {
    "batteryLevel": 15  // < 20%
  }
}

If priority is MEDIUM or LOW:
  Response: success: false (throttled to save battery)

If priority is HIGH:
  Response: success: true (always allowed)
```

---

### Scenario 5: Arrival Detection

**Test Arrival at Destination**
```
Journey destination: 40.7128, -74.0060

Send location update:
{
  "location": {
    "latitude": 40.7130,  // Within 100m
    "longitude": -74.0062
  },
  "speed": 3.0  // < 5 m/s (slow)
}

Expected response:
{
  "success": true,
  "arrivalDetected": true
}

Check participant status:
GET {{baseUrl}}/journeys/{{journeyId}}

Participant status should be: "ARRIVED"
```

---

## ⚠️ Common Issues & Solutions

### Issue 1: "Authentication failed"
```
Problem: Invalid or expired Firebase token

Solution:
1. Register a new user to get a fresh token
2. Ensure token is properly saved in authToken variable
3. Check Authorization header format: "Bearer {{authToken}}"
```

### Issue 2: "Journey not found"
```
Problem: journeyId variable not set

Solution:
1. Run "Create Journey" request first
2. Verify journeyId is auto-saved (check Console)
3. Manually set journeyId in Collection Variables if needed
```

### Issue 3: "Not a participant of this journey"
```
Problem: User is not part of the journey

Solution:
1. Leader must invite the user
2. User must accept the invitation
3. Journey must be started (status: ACTIVE)
```

### Issue 4: "Rate limit exceeded"
```
Problem: Sent too many requests in 1 minute

Solution:
1. Wait 60 seconds before retrying
2. Use WebSocket for real-time updates (preferred)
3. Reduce request frequency
```

---

## 🔧 Advanced Testing Tips

### 1. Using Collection Runner

Run entire test flow automatically:
1. Click **Runner** in Postman
2. Select "Tu-Link Backend API" collection
3. Click **Run Tu-Link Backend API**
4. View results for all requests

### 2. Using Pre-request Scripts

Add delays between requests:
```javascript
// In Pre-request Script tab
setTimeout(function(){}, 1000);  // 1 second delay
```

### 3. Using Tests Tab

Add custom assertions:
```javascript
// In Tests tab
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Response has sequenceNumber", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('sequenceNumber');
});
```

### 4. Environment Variables

Create multiple environments for different setups:

**Local Environment**:
- baseUrl: `http://localhost:3000`

**Staging Environment**:
- baseUrl: `https://staging.tulink.com`

**Production Environment**:
- baseUrl: `https://api.tulink.com`

Switch environments using the dropdown in top-right corner.

---

## 📊 Monitoring Responses

### Check Redis Data

During testing, monitor Redis:
```bash
redis-cli

# View sequence numbers
GET journey:{{journeyId}}:sequence

# View cached locations
GET journey:{{journeyId}}:location:{{participantId}}

# View active journeys
SMEMBERS active_journeys

# Monitor all commands in real-time
MONITOR
```

### Check Firestore Data

View data in Firebase Console:
```
Firebase Console → Firestore Database

Collections:
- journeys/{{journeyId}}
  - participants/{{userId}}
  - locations/{{locationId}}
  - lag_alerts/{{alertId}}
  - notifications/{{notificationId}}

- users/{{userId}}
- analytics/{{journeyId}}
```

---

## ✅ Testing Checklist

Before marking testing complete:

- [ ] All auth endpoints work (register, profile, update)
- [ ] Journey lifecycle complete (create → invite → accept → start → end)
- [ ] Location updates save to Firestore and Redis
- [ ] Priority calculation works correctly (HIGH/MEDIUM/LOW)
- [ ] Lag detection triggers for followers >500m away
- [ ] Arrival detection works when near destination
- [ ] Notifications are created for lag alerts
- [ ] Analytics calculated after journey ends
- [ ] Maps API endpoints work (geocode, distance, directions)
- [ ] Rate limiting prevents >60 requests/min
- [ ] Throttling works based on time and battery
- [ ] Multiple users can participate in same journey
- [ ] Sequence numbers increment correctly

---

## 🚀 Next Steps

After testing with Postman:

1. **Test WebSocket Connection**
   - Use Socket.io client (see LEARNING_GUIDE.md)
   - Test real-time location updates
   - Verify lag alerts broadcast

2. **Load Testing**
   - Use Postman Runner with multiple iterations
   - Test 1000+ concurrent connections
   - Measure response times

3. **Integration Testing**
   - Write automated tests (Jest + Supertest)
   - Mock Firebase and Redis
   - Test error scenarios

4. **Deploy to Staging**
   - Set up environment variables
   - Deploy to cloud provider
   - Update baseUrl in Postman environment

Happy Testing! 🎉
