# Authentication Quick Start Guide

## Setup

### 1. Environment Variables

Add to your `.env` file:

```env
FIREBASE_API_KEY=ADD_KEY
```

Get this from Firebase Console → Project Settings → Web API Key

### 2. Start the Server

```bash
npm run start:dev
```

## Quick Test Flow

### Step 1: Register a New User

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "displayName": "Test User"
  }'
```

**Response:**
- Returns `customToken` in `data.tokens.customToken`
- Save this token for next requests

### Step 2: Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Step 3: Access Protected Endpoint

```bash
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Step 4: Refresh Token

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Step 5: Logout

```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Available Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/auth/register` | No | Create new account |
| POST | `/auth/login` | No | Login with credentials |
| POST | `/auth/refresh` | Yes | Get new token |
| POST | `/auth/logout` | Yes | Revoke tokens |
| GET | `/auth/profile` | Yes | Get user profile |
| PUT | `/auth/profile` | Yes | Update profile |

## Response Format

All responses follow this structure:

**Success:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "...",
  "data": { ... },
  "timestamp": "...",
  "path": "..."
}
```

**Error:**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "...",
  "error": {
    "code": "...",
    "details": ...
  },
  "timestamp": "...",
  "path": "..."
}
```

## Token Usage

### Custom Token Flow

1. **Backend generates** Firebase custom token
2. **Client receives** custom token from register/login
3. **Client uses** custom token in Authorization header
4. **Backend verifies** token using Firebase Admin SDK

### Token Format

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Expiration

- Tokens expire after **1 hour** (3600 seconds)
- Use `/auth/refresh` to get a new token
- Implement auto-refresh in your client

## Common Issues

### 1. "Firebase API Key is not configured"

**Solution:** Add `FIREBASE_API_KEY` to your `.env` file

### 2. "Invalid email or password"

**Solution:** Check credentials are correct, user exists

### 3. "No authentication token provided"

**Solution:** Add `Authorization: Bearer <token>` header

### 4. "Invalid authentication token"

**Solution:** Token expired or invalid, get new token via `/auth/refresh` or `/auth/login`

### 5. Phone number validation error

**Solution:** Use E.164 format: `+254712345678`

## Interactive Testing

Visit Swagger UI at: `http://localhost:3000/api`

## Next Steps

1. ✅ Configure Firebase API Key in `.env`
2. ✅ Test registration endpoint
3. ✅ Test login endpoint
4. ✅ Test protected endpoints with token
5. ✅ Implement client-side integration
6. ✅ Add token auto-refresh logic

## Client Integration Example

```javascript
// 1. Login
const loginResponse = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});

const { data } = await loginResponse.json();

// 2. Store token
localStorage.setItem('token', data.tokens.customToken);

// 3. Use token in requests
const profileResponse = await fetch('/auth/profile', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});

// 4. Handle token expiration
if (profileResponse.status === 401) {
  // Refresh token or redirect to login
}
```

## Security Checklist

- ✅ Tokens stored securely (not in URL/logs)
- ✅ HTTPS in production
- ✅ Token expiration implemented
- ✅ Logout revokes tokens
- ✅ Password minimum 6 characters
- ✅ Email validation
- ✅ Phone number E.164 format

## Support

For detailed documentation, see:
- [AUTHENTICATION_FLOW.md](./AUTHENTICATION_FLOW.md) - Complete guide
- [API_RESPONSE_STRUCTURE.md](./API_RESPONSE_STRUCTURE.md) - Response format details
