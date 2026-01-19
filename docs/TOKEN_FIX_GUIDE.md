# Authentication Token Fix - ID Token vs Custom Token

## The Problem

You were receiving a `401 Unauthorized` error when using the token returned from `/auth/register` or `/auth/login`.

### Why This Happened

Firebase has **two different types of tokens**:

1. **Custom Token** - Created by Firebase Admin SDK (server-side)
   - Used to sign in users on client apps
   - Cannot be directly verified by `verifyIdToken()`
   - Needs to be exchanged for an ID token

2. **ID Token** - Created after authentication
   - Used for API authentication
   - Can be verified by `verifyIdToken()`
   - This is what `FirebaseAuthGuard` expects

**The issue:** We were returning **Custom Tokens**, but the `FirebaseAuthGuard` expected **ID Tokens**.

## The Solution

We've updated the authentication endpoints to return **ID Tokens** instead of Custom Tokens.

### What Changed

#### 1. Register Endpoint (`POST /auth/register`)

**Before:**
```javascript
// Created user, then generated custom token
const customToken = await firebase.auth.createCustomToken(uid);
return { tokens: { customToken, expiresIn: 3600 } };
```

**After:**
```javascript
// Create user, then sign them in to get ID token
const signInResponse = await axios.post(
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
  { email, password, returnSecureToken: true }
);

const { idToken, refreshToken, expiresIn } = signInResponse.data;
return { tokens: { idToken, refreshToken, expiresIn } };
```

#### 2. Login Endpoint (`POST /auth/login`)

**Before:**
```javascript
// Verified credentials, then generated custom token
const customToken = await firebase.auth.createCustomToken(localId);
return { tokens: { customToken, expiresIn } };
```

**After:**
```javascript
// Verify credentials using Firebase REST API (returns ID token automatically)
const { idToken, refreshToken, expiresIn } = response.data;
return { tokens: { idToken, refreshToken, expiresIn } };
```

#### 3. Refresh Token Endpoint (`POST /auth/refresh`)

**Before:**
```javascript
// Required authentication, generated new custom token
const customToken = await firebase.auth.createCustomToken(uid);
return { customToken, expiresIn: 3600 };
```

**After:**
```javascript
// Uses refresh token to get new ID token (no auth required)
const response = await axios.post(
  'https://securetoken.googleapis.com/v1/token',
  { grant_type: 'refresh_token', refresh_token: refreshToken }
);

const { id_token, refresh_token, expires_in } = response.data;
return { idToken: id_token, refreshToken: refresh_token, expiresIn: expires_in };
```

### Updated Response Format

#### New Response Structure

**Register/Login Response:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "user": {
      "uid": "abc123xyz",
      "email": "user@example.com",
      "displayName": "John Doe",
      "emailVerified": false
    },
    "tokens": {
      "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "AMf-vBzG6FZPyqe3Zt8K...",
      "expiresIn": 3600
    }
  }
}
```

**Refresh Token Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "AMf-vBzG6FZPyqe3Zt8K...",
    "expiresIn": 3600
  }
}
```

## How to Use the Tokens

### 1. Register or Login

```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "displayName": "John Doe"
  }'

# Or Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Response:**
```json
{
  "data": {
    "tokens": {
      "idToken": "eyJhbGci...",      ← Use this for authentication
      "refreshToken": "AMf-vBz...",   ← Save this for refreshing
      "expiresIn": 3600               ← Token expires in 1 hour
    }
  }
}
```

### 2. Use ID Token for Authentication

```bash
# Use the idToken in Authorization header
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer eyJhbGci..."
                              ↑
                         Your idToken
```

**This will now work!** ✅

### 3. Refresh Token When Expired

Before the token expires (within 1 hour), refresh it:

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "AMf-vBz..."
  }'
```

**Response:**
```json
{
  "data": {
    "idToken": "new_eyJhbGci...",           ← New ID token
    "refreshToken": "new_AMf-vBz...",       ← New refresh token
    "expiresIn": 3600
  }
}
```

Use the new `idToken` for subsequent requests.

## Token Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    COMPLETE TOKEN FLOW                       │
└─────────────────────────────────────────────────────────────┘

1. REGISTER/LOGIN
   └─► Returns: idToken + refreshToken

2. USE idToken for authenticated requests
   └─► Authorization: Bearer {idToken}

3. WHEN TOKEN EXPIRES (after 1 hour)
   └─► Use refreshToken to get new tokens
       POST /auth/refresh
       Body: { "refreshToken": "..." }

4. REPEAT: Use new idToken, refresh when needed

5. LOGOUT (optional)
   └─► POST /auth/logout (revokes refresh tokens)
```

## Key Differences: Custom Token vs ID Token

| Feature | Custom Token | ID Token |
|---------|-------------|----------|
| **Created by** | Firebase Admin SDK | Firebase Auth (after sign-in) |
| **Purpose** | Client-side authentication | API request authentication |
| **Verified by** | Cannot be verified directly | `verifyIdToken()` |
| **Expiration** | Custom (we set it) | 1 hour (Firebase default) |
| **Use case** | Give to client to sign in | Use in Authorization header |
| **Works with FirebaseAuthGuard** | ❌ No | ✅ Yes |

## Troubleshooting

### Issue: Still getting 401 Unauthorized

**Check 1: Are you using the idToken?**
```bash
# ❌ Wrong - using customToken (old field name)
Authorization: Bearer {response.data.tokens.customToken}

# ✅ Correct - using idToken
Authorization: Bearer {response.data.tokens.idToken}
```

**Check 2: Is the token valid?**
```bash
# Token expires after 3600 seconds (1 hour)
# If expired, login again or use refresh token
```

**Check 3: Is FIREBASE_API_KEY set?**
```bash
# Check your .env file
FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXX

# Restart server after adding
```

### Issue: Refresh token not working

**Check: Are you sending the refresh token in the body?**
```bash
# ✅ Correct
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "AMf-vBz..."}'

# ❌ Wrong - sending in Authorization header
curl -X POST http://localhost:3000/auth/refresh \
  -H "Authorization: Bearer AMf-vBz..."
```

## Testing the Fix

### Test 1: Register and Access Protected Endpoint

```bash
# 1. Register
RESPONSE=$(curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "displayName": "Test User"
  }')

# 2. Extract idToken
ID_TOKEN=$(echo $RESPONSE | jq -r '.data.tokens.idToken')

# 3. Use idToken to access profile
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer $ID_TOKEN"

# ✅ Should return user profile
```

### Test 2: Login and Access Protected Endpoint

```bash
# 1. Login
RESPONSE=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }')

# 2. Extract idToken
ID_TOKEN=$(echo $RESPONSE | jq -r '.data.tokens.idToken')

# 3. Use idToken
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer $ID_TOKEN"

# ✅ Should return user profile
```

### Test 3: Refresh Token

```bash
# 1. Login and save tokens
RESPONSE=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }')

REFRESH_TOKEN=$(echo $RESPONSE | jq -r '.data.tokens.refreshToken')

# 2. Refresh to get new tokens
NEW_RESPONSE=$(curl -s -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")

NEW_ID_TOKEN=$(echo $NEW_RESPONSE | jq -r '.data.idToken')

# 3. Use new idToken
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer $NEW_ID_TOKEN"

# ✅ Should return user profile with new token
```

## Summary

✅ **Fixed:** Authentication now returns **ID Tokens** that work with `FirebaseAuthGuard`
✅ **Updated:** All endpoints now return proper Firebase ID tokens
✅ **Added:** Refresh token support for token renewal
✅ **Works:** You can now authenticate and access protected endpoints

### Quick Reference

**What to use:**
- Use `idToken` in `Authorization: Bearer {idToken}` header
- Save `refreshToken` for renewing tokens
- Refresh tokens before they expire (within 1 hour)

**What changed:**
- Response field: `customToken` → `idToken` (more accurate naming)
- Added: `refreshToken` to responses
- Fixed: Tokens now work with Firebase auth verification

The authentication system is now fully functional! 🎉
