# Postman Token Management Guide

## Overview

The Tu-Link Postman collection is configured to **automatically save and use authentication tokens** across all requests. This guide explains how it works.

## How Token Management Works

### 1. Collection-Level Authentication

The collection has **global authentication** configured:

```json
{
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "{{authToken}}",
        "type": "string"
      }
    ]
  }
}
```

**What this means:**
- Every request in the collection automatically inherits this authentication
- All requests automatically use `Authorization: Bearer {{authToken}}`
- You don't need to manually add auth headers to each request

### 2. Automatic Token Saving

When you register or login, the token is **automatically extracted and saved**:

#### Register User - Test Script
```javascript
if (pm.response.code === 201) {
    const response = pm.response.json();
    if (response.success && response.data) {
        // Save token to collection variable
        pm.environment.set('authToken', response.data.tokens.customToken);
        pm.environment.set('userId', response.data.user.uid);
        pm.environment.set('userEmail', response.data.user.email);

        console.log('✅ Token saved:', response.data.tokens.customToken);
        console.log('✅ User ID:', response.data.user.uid);
        console.log('✅ Token expires in:', response.data.tokens.expiresIn, 'seconds');
    }
}
```

#### Login User - Test Script
```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    if (response.success && response.data) {
        // Save token to collection variable
        pm.environment.set('authToken', response.data.tokens.customToken);
        pm.environment.set('userId', response.data.user.uid);
        pm.environment.set('userEmail', response.data.user.email);

        console.log('✅ Login successful');
        console.log('✅ Token saved:', response.data.tokens.customToken);
        console.log('✅ Token expires in:', response.data.tokens.expiresIn, 'seconds');
    }
}
```

#### Refresh Token - Test Script
```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    if (response.success && response.data) {
        // Update token with new one
        pm.environment.set('authToken', response.data.customToken);

        console.log('✅ Token refreshed successfully');
        console.log('✅ New token expires in:', response.data.expiresIn, 'seconds');
    }
}
```

### 3. Token Usage Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Token Lifecycle                          │
└─────────────────────────────────────────────────────────────┘

1. REGISTER/LOGIN
   ┌──────────────┐
   │ POST /auth   │
   │ /register or │──────► Response with customToken
   │ /login       │
   └──────────────┘
          │
          ▼
   [Test Script Runs]
          │
          ▼
   pm.environment.set('authToken', token)
          │
          ▼
   ┌──────────────────┐
   │ Token saved to   │
   │ {{authToken}}    │
   └──────────────────┘

2. SUBSEQUENT REQUESTS
   ┌──────────────────┐
   │ Any Request      │
   │ (GET /profile,   │
   │  POST /journeys, │
   │  etc.)           │
   └────────┬─────────┘
            │
            ▼
   [Collection Auth Kicks In]
            │
            ▼
   Authorization: Bearer {{authToken}}
            │
            ▼
   ┌──────────────────┐
   │ Request sent     │
   │ with token       │
   └──────────────────┘

3. TOKEN REFRESH
   ┌──────────────────┐
   │ POST /auth       │
   │ /refresh         │──────► New customToken
   └──────────────────┘
          │
          ▼
   [Test Script Updates Token]
          │
          ▼
   pm.environment.set('authToken', newToken)
          │
          ▼
   All future requests use new token
```

## Step-by-Step Usage

### Initial Setup

1. **Import Collection**
   ```
   File → Import → Tu-Link-Backend.postman_collection.json
   ```

2. **Verify Variables Tab**
   ```
   Click collection → Variables tab
   ✅ authToken should exist (empty initially)
   ✅ userId should exist (empty initially)
   ✅ baseUrl = http://localhost:3000
   ```

### Getting Your First Token

**Option 1: Register New User**
```
1. Open: Auth → Register User (Leader)
2. Click: Send
3. Check Console (bottom panel):
   ✅ Token saved: eyJhbGci...
   ✅ User ID: abc123xyz
   ✅ Token expires in: 3600 seconds
4. Check Variables tab:
   ✅ authToken = eyJhbGci...
   ✅ userId = abc123xyz
```

**Option 2: Login Existing User**
```
1. Open: Auth → Login User
2. Update request body with your credentials:
   {
     "email": "your@email.com",
     "password": "yourpassword"
   }
3. Click: Send
4. Check Console:
   ✅ Login successful
   ✅ Token saved: eyJhbGci...
5. Check Variables tab:
   ✅ authToken = eyJhbGci...
```

### Using Protected Endpoints

**All these requests automatically use your saved token:**

```
✅ GET /auth/profile
✅ PUT /auth/profile
✅ POST /journeys
✅ GET /journeys/active
✅ POST /locations
✅ GET /notifications
✅ POST /auth/refresh
✅ POST /auth/logout
... and all other protected endpoints
```

**You don't need to do anything!** The token is automatically added.

### Verifying Token is Used

**Method 1: Check Headers Tab**
```
1. Open any protected request (e.g., GET /auth/profile)
2. Go to "Headers" tab
3. Look for auto-generated header:
   Authorization: Bearer {{authToken}}
   ✅ This is automatically added by collection auth
```

**Method 2: Check Authorization Tab**
```
1. Open any request
2. Go to "Authorization" tab
3. Type: "Inherit auth from parent"
4. This means it uses collection-level auth ({{authToken}})
```

### Refreshing Tokens

Tokens expire after 1 hour. Before expiration:

```
1. Open: Auth → Refresh Token
2. Click: Send
3. Check Console:
   ✅ Token refreshed successfully
   ✅ New token expires in: 3600 seconds
4. Check Variables tab:
   ✅ authToken = [new token value]
5. All future requests automatically use new token
```

### Managing Multiple Users

The collection supports multiple users with separate tokens:

| Variable | Purpose | Used For |
|----------|---------|----------|
| `authToken` | Leader/primary user | Most requests (default) |
| `follower1Token` | Follower 1 | Testing follower actions |
| `follower2Token` | Follower 2 | Testing follower actions |

**To switch users:**

```
1. Open request
2. Go to "Authorization" tab
3. Click dropdown: "Inherit auth from parent"
4. Select: "Bearer Token"
5. In Token field, enter: {{follower1Token}}
6. Send request (now using follower1's token)
```

**Or use the pre-configured requests:**
```
Auth → Accept Invitation
└─ Already configured to use {{follower1Token}}
```

## Troubleshooting

### Issue: Requests Failing with 401 Unauthorized

**Check 1: Is token saved?**
```
1. Click collection name
2. Go to Variables tab
3. Check authToken value
   ❌ Empty? → Run register or login first
   ✅ Has value? → Continue to Check 2
```

**Check 2: Has token expired?**
```
Tokens expire after 3600 seconds (1 hour)
Solution:
1. Run: Auth → Login User
2. Or: Auth → Refresh Token
```

**Check 3: Is authorization inherited?**
```
1. Open failing request
2. Go to Authorization tab
3. Verify Type = "Inherit auth from parent"
   ❌ If "No Auth" → Change to "Inherit auth from parent"
```

### Issue: Token Not Being Saved

**Check Console for Errors:**
```
1. Open: View → Show Postman Console
2. Run register/login request
3. Look for console output:
   ✅ "Token saved: ..." → Working correctly
   ❌ No output or errors → Check response format
```

**Verify Response Format:**
```
Expected response:
{
  "success": true,
  "data": {
    "user": { "uid": "...", ... },
    "tokens": { "customToken": "...", "expiresIn": 3600 }
  }
}

If different, test script needs updating
```

**Manual Token Save (if needed):**
```
1. Run register/login request
2. Copy customToken from response
3. Go to Variables tab
4. Paste into authToken Current Value
5. Click Save
```

### Issue: Different Token for Each Request

**Symptom:** Each request seems to use a different token

**Cause:** Environment vs Collection variables confusion

**Solution:**
```
1. Close all environments (top-right dropdown = "No Environment")
2. Use Collection Variables only
3. Check: Collection → Variables tab
4. authToken should be there
```

## Best Practices

### 1. Start Fresh Each Session
```
1. Open Postman
2. Run: Auth → Login User
3. Verify console: "✅ Token saved"
4. Start testing
```

### 2. Monitor Token Expiration
```
- Note the time when you login
- Tokens expire after 1 hour
- Set a reminder to refresh after 50 minutes
- Or just re-login when you get 401 errors
```

### 3. Use Console for Debugging
```
Always keep Console open:
View → Show Postman Console

You'll see:
✅ Token saved: ...
✅ Token expires in: 3600 seconds
✅ Token refreshed successfully
```

### 4. Organize Your Workflow
```
Daily Testing Flow:
1. Auth → Login User
2. Test your features
3. (50 min later) Auth → Refresh Token
4. Continue testing
5. (When done) Auth → Logout
```

### 5. Multiple User Testing
```
For convoy testing:
1. Register/Login Leader → authToken saved
2. Register/Login Follower 1 → follower1Token saved
3. Register/Login Follower 2 → follower2Token saved
4. Use appropriate token variable for each user's actions
```

## Advanced: Custom Test Scripts

If you need to customize token handling:

### Example: Log Token Expiration Time
```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    if (response.success && response.data) {
        const token = response.data.tokens.customToken;
        const expiresIn = response.data.tokens.expiresIn;

        // Save token
        pm.environment.set('authToken', token);

        // Calculate expiration time
        const expiresAt = new Date(Date.now() + (expiresIn * 1000));
        console.log('✅ Token expires at:', expiresAt.toLocaleString());

        // Save expiration time
        pm.environment.set('tokenExpiresAt', expiresAt.toISOString());
    }
}
```

### Example: Auto-Refresh Token
```javascript
// In Pre-request Script (collection level)
const tokenExpiresAt = pm.environment.get('tokenExpiresAt');
if (tokenExpiresAt) {
    const expiresDate = new Date(tokenExpiresAt);
    const now = new Date();
    const minutesUntilExpiry = (expiresDate - now) / 1000 / 60;

    if (minutesUntilExpiry < 5) {
        console.log('⚠️ Token expires in', minutesUntilExpiry.toFixed(1), 'minutes');
        console.log('🔄 Consider refreshing token');
    }
}
```

## Summary

✅ **Automatic Token Saving** - Register/Login scripts save token to `authToken`
✅ **Automatic Token Usage** - Collection-level auth adds token to all requests
✅ **Console Feedback** - Clear logging of token operations
✅ **Multiple Users** - Support for leader and follower tokens
✅ **Token Refresh** - Easy token renewal before expiration
✅ **Zero Configuration** - Works out of the box after import

**You never need to manually copy/paste tokens!** Everything is automated. 🎉

## Quick Reference

| Action | Command |
|--------|---------|
| Get first token | `Auth → Register User` or `Auth → Login User` |
| Check token saved | `Collection → Variables → authToken` |
| Use token | Automatic (all requests inherit collection auth) |
| Refresh token | `Auth → Refresh Token` |
| Clear token | `Auth → Logout` (or manually clear variable) |
| Check expiration | Console logs after login/refresh |
| Debug issues | `View → Show Postman Console` |
