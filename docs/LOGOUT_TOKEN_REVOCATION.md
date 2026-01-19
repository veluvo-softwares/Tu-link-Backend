# Logout and Token Revocation

## Overview

The logout implementation now properly invalidates ID tokens by checking the token's issued time against Firebase's revocation timestamp. This prevents logged-out users from accessing protected routes with previously valid tokens.

## How It Works

### The Problem

When a user logs out, calling `revokeRefreshTokens()` only prevents the user from getting new ID tokens using their refresh token. However, **existing ID tokens remain valid** until they expire (typically 1 hour). This means a logged-out user could still access protected routes with their old token.

### The Solution

We enhanced the `FirebaseAuthGuard` to check if a token was issued before the user's logout time:

```typescript
// 1. Verify the token is structurally valid
const decodedToken = await this.firebaseService.auth.verifyIdToken(token);

// 2. Get user record (contains tokensValidAfterTime)
const userRecord = await this.firebaseService.auth.getUser(decodedToken.uid);

// 3. Check if token was issued before logout
if (userRecord.tokensValidAfterTime) {
  const tokenIssuedAt = new Date(decodedToken.iat * 1000);
  const tokensValidAfter = new Date(userRecord.tokensValidAfterTime);

  if (tokenIssuedAt < tokensValidAfter) {
    throw new UnauthorizedException('Token has been revoked. Please login again.');
  }
}
```

## Implementation Details

### File: `src/common/guards/firebase-auth.guard.ts`

The guard now performs these checks on every protected request:

1. **Extract token** from Authorization header
2. **Verify token** cryptographic signature and structure
3. **Fetch user record** from Firebase Auth
4. **Compare timestamps**:
   - Token issued at (`iat` claim in JWT)
   - Tokens valid after time (set by `revokeRefreshTokens()`)
5. **Reject if revoked**: Token issued before revocation time → Unauthorized

### File: `src/modules/auth/auth.service.ts`

The logout method:

```typescript
async logout(uid: string): Promise<{ message: string }> {
  // Revoke all refresh tokens and set tokensValidAfterTime
  await this.firebaseService.auth.revokeRefreshTokens(uid);

  // Track logout time in Firestore
  await this.firebaseService.firestore
    .collection('users')
    .doc(uid)
    .update({
      lastLogout: FieldValue.serverTimestamp(),
    });

  return {
    message: 'Successfully logged out',
  };
}
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Logout Flow                             │
└─────────────────────────────────────────────────────────────┘

1. User calls POST /auth/logout
   └─► Token: eyJhbGci... (issued at 10:00 AM)

2. Backend calls revokeRefreshTokens(uid)
   └─► Firebase sets tokensValidAfterTime = 10:05 AM

3. Backend updates Firestore
   └─► lastLogout: "2026-01-18T10:05:00.000Z"

4. User tries to access GET /auth/profile
   └─► Same token: eyJhbGci... (issued at 10:00 AM)

5. FirebaseAuthGuard checks:
   ✓ Token signature valid
   ✓ Token not expired
   ✗ Token issued (10:00 AM) < tokensValidAfterTime (10:05 AM)
   └─► REJECTED: "Token has been revoked. Please login again."
```

## Timeline Example

```
09:00 AM - User logs in
           ├─ Gets ID token (valid until 10:00 AM)
           └─ Gets refresh token

09:30 AM - User uses ID token → ✅ Access granted

09:45 AM - User calls /auth/logout
           ├─ tokensValidAfterTime set to 09:45 AM
           └─ lastLogout: "2026-01-18T09:45:00.000Z"

09:46 AM - User tries to use old ID token → ❌ REJECTED
           └─ Token issued at 09:00 AM < 09:45 AM

09:47 AM - User tries to refresh token → ❌ REJECTED
           └─ Refresh token revoked

10:00 AM - User must login again → ✅ New tokens issued
           └─ tokensValidAfterTime now 10:00 AM
```

## API Behavior

### Successful Logout

**Request:**
```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer eyJhbGci..."
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "message": "Successfully logged out"
  }
}
```

### Using Revoked Token

**Request:**
```bash
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer eyJhbGci..."
```

**Response:**
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Token has been revoked. Please login again.",
  "error": {
    "code": "UNAUTHORIZED"
  }
}
```

## Testing the Fix

### Test Case 1: Normal Logout Flow

```bash
# 1. Login
LOGIN_RESPONSE=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }')

ID_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.tokens.idToken')

# 2. Access profile (should work)
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer $ID_TOKEN"
# ✅ Returns profile data

# 3. Logout
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $ID_TOKEN"
# ✅ Logout successful

# 4. Try to access profile again with same token
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer $ID_TOKEN"
# ❌ Returns 401: "Token has been revoked. Please login again."
```

### Test Case 2: Multiple Devices

```bash
# User logs in on Device A
TOKEN_A=$(curl ... /auth/login | jq -r '.data.tokens.idToken')

# User logs in on Device B
TOKEN_B=$(curl ... /auth/login | jq -r '.data.tokens.idToken')

# User logs out on Device A
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $TOKEN_A"

# Both tokens are now invalid (global revocation)
curl -H "Authorization: Bearer $TOKEN_A" .../profile  # ❌ 401
curl -H "Authorization: Bearer $TOKEN_B" .../profile  # ❌ 401
```

## Performance Considerations

### Additional Database Call

The guard now makes an additional call to Firebase Auth on **every protected request**:

```typescript
const userRecord = await this.firebaseService.auth.getUser(decodedToken.uid);
```

**Impact:**
- **Latency**: Adds ~10-50ms per request
- **Firebase Quota**: Counts toward Firebase Auth user read quota

### Optimization Options (Future)

If performance becomes an issue, consider:

1. **Caching**: Cache `tokensValidAfterTime` in Redis with short TTL (1-5 minutes)
2. **Firestore Alternative**: Store revocation time in Firestore instead of Auth
3. **Token Blacklist**: Maintain revoked token IDs in Redis

## Security Benefits

✅ **Immediate invalidation**: Tokens become unusable immediately after logout
✅ **Global revocation**: All user's tokens revoked, not just the one used for logout
✅ **Replay attack prevention**: Old tokens cannot be reused after logout
✅ **Account security**: Compromised tokens invalidated on password change (if implemented)
✅ **Multi-device logout**: Logging out on one device logs out all devices

## Error Messages

| Scenario | Status | Message |
|----------|--------|---------|
| No token provided | 401 | "No authentication token provided" |
| Invalid token signature | 401 | "Invalid authentication token" |
| Expired token | 401 | "Invalid authentication token" |
| Revoked token | 401 | "Token has been revoked. Please login again." |
| Malformed token | 401 | "Invalid authentication token" |

## Related Files

- `src/common/guards/firebase-auth.guard.ts` - Token validation with revocation check
- `src/modules/auth/auth.service.ts` - Logout implementation
- `src/modules/auth/auth.controller.ts` - Logout endpoint definition

## Summary

The logout implementation now properly invalidates ID tokens by:

1. Calling `revokeRefreshTokens(uid)` which sets `tokensValidAfterTime`
2. Checking token issued time against `tokensValidAfterTime` on every request
3. Rejecting tokens issued before the revocation time

This ensures that logged-out users cannot access protected routes, even with previously valid tokens.
