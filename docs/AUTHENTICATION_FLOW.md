# Complete Authentication Flow Documentation

## Overview

This document describes the complete authentication flow for the Tu-Link backend API, including registration, login, token management, and logout functionality.

## Architecture

The authentication system uses **Firebase Authentication** with custom tokens:

- **Firebase Admin SDK**: Server-side user management
- **Firebase REST API**: Password verification
- **Custom Tokens**: Server-generated tokens for client authentication
- **Token Revocation**: Session management and security

## Authentication Endpoints

### 1. Register (`POST /auth/register`)

Creates a new user account and returns authentication tokens immediately.

#### Request Body

```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "displayName": "John Doe",
  "phoneNumber": "+254712345678"  // Optional, must be in E.164 format
}
```

#### Success Response (201 Created)

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "user": {
      "uid": "abc123xyz789",
      "email": "user@example.com",
      "displayName": "John Doe",
      "phoneNumber": "+254712345678",
      "emailVerified": false
    },
    "tokens": {
      "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 3600
    }
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/register"
}
```

#### Error Responses

**409 Conflict** - Email already exists
```json
{
  "success": false,
  "statusCode": 409,
  "message": "Email address is already in use",
  "error": {
    "code": "CONFLICT"
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/register"
}
```

**400 Bad Request** - Invalid phone number format
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "field": "phoneNumber",
        "message": "phoneNumber must be in E.164 format (e.g., +254712345678)",
        "constraint": "validation_failed"
      }
    ]
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/register"
}
```

---

### 2. Login (`POST /auth/login`)

Authenticates existing users and returns tokens.

#### Request Body

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "user": {
      "uid": "abc123xyz789",
      "email": "user@example.com",
      "displayName": "John Doe",
      "phoneNumber": "+254712345678",
      "emailVerified": false
    },
    "tokens": {
      "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 3600
    }
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/login"
}
```

#### Error Responses

**401 Unauthorized** - Invalid credentials
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid email or password",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/login"
}
```

**401 Unauthorized** - Account disabled
```json
{
  "success": false,
  "statusCode": 401,
  "message": "This account has been disabled",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/login"
}
```

---

### 3. Refresh Token (`POST /auth/refresh`)

Generates a new authentication token for the current user.

#### Headers

```
Authorization: Bearer <custom_token>
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/refresh"
}
```

#### Error Responses

**401 Unauthorized** - Invalid or expired token
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid authentication token",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/refresh"
}
```

---

### 4. Logout (`POST /auth/logout`)

Revokes all refresh tokens and logs the user out.

#### Headers

```
Authorization: Bearer <custom_token>
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "message": "Successfully logged out"
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/logout"
}
```

---

### 5. Get Profile (`GET /auth/profile`)

Retrieves the current user's profile information.

#### Headers

```
Authorization: Bearer <custom_token>
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "abc123xyz789",
    "email": "user@example.com",
    "displayName": "John Doe",
    "phoneNumber": "+254712345678",
    "createdAt": "2026-01-18T15:30:00.000Z",
    "updatedAt": "2026-01-18T15:30:00.000Z"
  },
  "timestamp": "2026-01-18T15:30:00.000Z",
  "path": "/auth/profile"
}
```

---

### 6. Update Profile (`PUT /auth/profile`)

Updates the current user's profile information.

#### Headers

```
Authorization: Bearer <custom_token>
```

#### Request Body

```json
{
  "displayName": "Jane Doe",
  "phoneNumber": "+254798765432"
}
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "id": "abc123xyz789",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "phoneNumber": "+254798765432",
    "createdAt": "2026-01-18T15:30:00.000Z",
    "updatedAt": "2026-01-18T16:00:00.000Z"
  },
  "timestamp": "2026-01-18T16:00:00.000Z",
  "path": "/auth/profile"
}
```

---

## Authentication Flow

### Complete Flow Diagram

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ 1. Register/Login
       ├──────────────────────────────────────────┐
       │                                          │
       ▼                                          ▼
┌──────────────────┐                    ┌─────────────────┐
│  POST /register  │                    │  POST /login    │
│  or /login       │                    │                 │
└────────┬─────────┘                    └────────┬────────┘
         │                                       │
         │ 2. Server validates credentials       │
         │    and creates/verifies user          │
         │                                       │
         ▼                                       │
┌──────────────────────────────────────────────┐│
│  Firebase Admin SDK                          ││
│  - createUser() or verifyPassword()          ││
│  - createCustomToken()                       ││
└────────┬─────────────────────────────────────┘│
         │                                       │
         │ 3. Returns custom token               │
         │    and user data                      │
         │                                       │
         ▼                                       │
┌──────────────────────────────────────────────┐│
│  Response with tokens                        ││
│  {                                           ││
│    user: {...},                              ││
│    tokens: {                                 ││
│      customToken: "...",                     ││
│      expiresIn: 3600                         ││
│    }                                         ││
│  }                                           ││
└────────┬─────────────────────────────────────┘│
         │                                       │
         │ 4. Client stores token                │
         │    (localStorage/SecureStorage)       │
         │                                       │
         ▼                                       │
┌──────────────────────────────────────────────┐│
│  Client uses token for API calls             ││
│  Authorization: Bearer <customToken>         ││
└────────┬─────────────────────────────────────┘│
         │                                       │
         │ 5. Server verifies token on           │
         │    protected endpoints                │
         │                                       │
         ▼                                       │
┌──────────────────────────────────────────────┐│
│  FirebaseAuthGuard                           ││
│  - verifyIdToken()                           ││
│  - Attaches user to request                  ││
└────────┬─────────────────────────────────────┘│
         │                                       │
         │ 6. Token expires or logout            │
         │                                       │
         ▼                                       │
┌──────────────────────────────────────────────┐│
│  POST /auth/refresh   OR   POST /auth/logout││
└──────────────────────────────────────────────┘│
                                                │
────────────────────────────────────────────────┘
```

---

## Client Integration Guide

### Step 1: Register a New User

```javascript
async function register(email, password, displayName, phoneNumber) {
  try {
    const response = await fetch('http://localhost:3000/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        displayName,
        phoneNumber, // Optional
      }),
    });

    const result = await response.json();

    if (result.success) {
      // Store the custom token
      localStorage.setItem('authToken', result.data.tokens.customToken);
      localStorage.setItem('user', JSON.stringify(result.data.user));

      console.log('Registered successfully:', result.data.user);
      return result.data;
    } else {
      console.error('Registration failed:', result.message);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
}
```

### Step 2: Login

```javascript
async function login(email, password) {
  try {
    const response = await fetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const result = await response.json();

    if (result.success) {
      // Store the custom token
      localStorage.setItem('authToken', result.data.tokens.customToken);
      localStorage.setItem('user', JSON.stringify(result.data.user));

      console.log('Logged in successfully:', result.data.user);
      return result.data;
    } else {
      console.error('Login failed:', result.message);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}
```

### Step 3: Make Authenticated Requests

```javascript
async function getProfile() {
  const token = localStorage.getItem('authToken');

  if (!token) {
    throw new Error('No authentication token found');
  }

  try {
    const response = await fetch('http://localhost:3000/auth/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const result = await response.json();

    if (result.success) {
      return result.data;
    } else {
      // Token might be expired, try refreshing
      if (result.statusCode === 401) {
        await refreshToken();
        return getProfile(); // Retry with new token
      }
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Get profile error:', error);
    throw error;
  }
}
```

### Step 4: Refresh Token

```javascript
async function refreshToken() {
  const token = localStorage.getItem('authToken');

  try {
    const response = await fetch('http://localhost:3000/auth/refresh', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const result = await response.json();

    if (result.success) {
      // Update stored token
      localStorage.setItem('authToken', result.data.customToken);
      return result.data.customToken;
    } else {
      // Refresh failed, redirect to login
      logout();
      throw new Error('Session expired. Please login again.');
    }
  } catch (error) {
    console.error('Token refresh error:', error);
    throw error;
  }
}
```

### Step 5: Logout

```javascript
async function logout() {
  const token = localStorage.getItem('authToken');

  if (token) {
    try {
      await fetch('http://localhost:3000/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  // Clear local storage regardless of API response
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');

  // Redirect to login page
  window.location.href = '/login';
}
```

---

## Environment Variables

Add the following to your `.env` file:

```env
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project-id.firebaseio.com
FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**How to get Firebase API Key:**
1. Go to Firebase Console → Project Settings
2. Under "General" tab, find "Web API Key"
3. Copy the key and add it to your `.env` file

---

## Security Considerations

### Token Storage
- **Web Apps**: Use `localStorage` or `sessionStorage`
- **Mobile Apps**: Use secure storage (Keychain for iOS, Keystore for Android)
- **Never** expose tokens in URLs or logs

### Token Lifecycle
- Tokens expire after 1 hour (`expiresIn: 3600`)
- Implement automatic token refresh before expiration
- Revoke tokens on logout

### Password Requirements
- Minimum 6 characters (Firebase requirement)
- Consider adding additional validation on the client side

### Phone Number Format
- Must be in E.164 format: `+[country code][number]`
- Example: `+254712345678` (Kenya), `+1234567890` (US)

---

## Error Handling Best Practices

1. **Always check `success` field** before processing response
2. **Use `error.code`** for programmatic error handling
3. **Display `message`** to users for general errors
4. **Show `error.details`** for validation errors
5. **Implement retry logic** for network errors
6. **Redirect to login** on 401 errors after refresh fails

---

## Testing

### Using cURL

**Register:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "displayName": "Test User",
    "phoneNumber": "+254712345678"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

**Get Profile:**
```bash
curl -X GET http://localhost:3000/auth/profile \
  -H "Authorization: Bearer YOUR_CUSTOM_TOKEN"
```

**Refresh Token:**
```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Authorization: Bearer YOUR_CUSTOM_TOKEN"
```

**Logout:**
```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer YOUR_CUSTOM_TOKEN"
```

---

## API Documentation

Access the interactive Swagger documentation at:
```
http://localhost:3000/api
```

This provides a full API explorer with request/response examples and the ability to test endpoints directly from your browser.
