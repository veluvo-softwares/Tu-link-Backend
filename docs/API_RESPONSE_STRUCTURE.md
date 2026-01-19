# API Response Structure

This document describes the standardized response format for all REST API endpoints in the Tu-Link backend.

## Overview

All API responses follow a consistent structure based on REST API best practices, making it easier for clients to handle responses predictably.

## Success Response Format

### Structure

```typescript
{
  success: true,
  statusCode: number,
  message: string,
  data: T
}
```

### Example: User Registration Success

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "user": {
      "uid": "abc123xyz",
      "email": "user@example.com",
      "displayName": "John Doe",
      "phoneNumber": "+254712345678",
      "emailVerified": false
    },
    "tokens": {
      "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
      "refreshToken": "AMf-vBzXXXXXXXXXXXXXXX...",
      "expiresIn": 3600
    }
  }
}
```

### Example: Get Profile Success

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "abc123xyz",
    "email": "user@example.com",
    "displayName": "John Doe",
    "phoneNumber": "+254712345678",
    "createdAt": "2026-01-15T10:30:00.000Z",
    "updatedAt": "2026-01-18T17:45:30.500Z"
  }
}
```

### Example: Update Profile Success

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "id": "abc123xyz",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "phoneNumber": "+254712345678",
    "createdAt": "2026-01-15T10:30:00.000Z",
    "updatedAt": "2026-01-18T18:20:15.800Z"
  }
}
```

## Error Response Format

### Structure

```typescript
{
  success: false,
  statusCode: number,
  message: string,
  error: {
    code: string,
    details?: any,
    stack?: string  // Only in development mode
  }
}
```

### Example: Validation Error

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
  }
}
```

### Example: Firebase Authentication Error

```json
{
  "success": false,
  "statusCode": 409,
  "message": "Email address is already in use",
  "error": {
    "code": "auth/email-already-exists",
    "details": null
  }
}
```

### Example: Invalid Phone Number Format

```json
{
  "success": false,
  "statusCode": 500,
  "message": "Invalid phone number format. Use E.164 format (e.g., +254712345678)",
  "error": {
    "code": "auth/invalid-phone-number",
    "details": "TOO_SHORT"
  }
}
```

### Example: Unauthorized Access

```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid token",
  "error": {
    "code": "UNAUTHORIZED",
    "details": null
  }
}
```

### Example: Resource Not Found

```json
{
  "success": false,
  "statusCode": 404,
  "message": "User not found",
  "error": {
    "code": "NOT_FOUND",
    "details": null
  }
}
```

## Common Error Codes

### HTTP Status Code Mappings

| Status Code | Error Code | Description |
|------------|------------|-------------|
| 400 | BAD_REQUEST | Invalid request format or parameters |
| 400 | VALIDATION_ERROR | Request validation failed |
| 401 | UNAUTHORIZED | Authentication required or invalid token |
| 403 | FORBIDDEN | Access denied |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource conflict (e.g., duplicate email) |
| 422 | UNPROCESSABLE_ENTITY | Request cannot be processed |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_SERVER_ERROR | Unexpected server error |

### Firebase-Specific Error Codes

| Error Code | Description |
|-----------|-------------|
| auth/email-already-exists | Email address is already registered |
| auth/invalid-email | Invalid email format |
| auth/invalid-password | Password doesn't meet requirements |
| auth/invalid-phone-number | Phone number format is invalid |
| auth/phone-number-already-exists | Phone number is already registered |
| auth/user-not-found | User account not found |
| auth/wrong-password | Incorrect password |
| auth/too-many-requests | Too many failed attempts |

## Implementation Details

### Files

- **Interfaces**: `src/common/interfaces/api-response.interface.ts`
- **Exception Filter**: `src/common/filters/http-exception.filter.ts`
- **Response Interceptor**: `src/common/interceptors/response.interceptor.ts`

### How It Works

1. **Success Responses**: The `ResponseInterceptor` automatically wraps all successful responses in the standard format.

2. **Error Responses**: The `HttpExceptionFilter` catches all exceptions and formats them into the standard error response structure.

3. **Validation Errors**: Class-validator errors are automatically transformed into the `VALIDATION_ERROR` format with detailed field information.

4. **Firebase Errors**: Firebase authentication errors are mapped to user-friendly messages with appropriate status codes.

## Best Practices

### For Frontend Developers

1. Always check the `success` field to determine if the request succeeded.
2. Use `statusCode` for HTTP status-based logic.
3. Display `message` to users for general feedback.
4. Use `error.code` for programmatic error handling.
5. Display `error.details` for validation errors.

### Example Client-Side Handling

```typescript
try {
  const response = await fetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });

  const result = await response.json();

  if (result.success) {
    // Handle success
    console.log(result.message);
    console.log(result.data);
  } else {
    // Handle error
    if (result.error.code === 'VALIDATION_ERROR') {
      // Display validation errors
      result.error.details.forEach(err => {
        console.error(`${err.field}: ${err.message}`);
      });
    } else {
      // Display general error
      console.error(result.message);
    }
  }
} catch (error) {
  console.error('Network error:', error);
}
```

## Phone Number Validation

Phone numbers must be in **E.164 format**:

- Start with `+`
- Include country code (e.g., `+254` for Kenya)
- No spaces, dashes, or parentheses
- Examples:
  - ✅ `+254712345678` (Kenya)
  - ✅ `+1234567890` (US)
  - ✅ `+447911123456` (UK)
  - ❌ `0712345678` (Missing country code)
  - ❌ `712345678` (Missing +)
  - ❌ `+254 712 345 678` (Contains spaces)

## Changelog

### Version 1.0 (2026-01-18)
- Initial standardized response structure
- Added Firebase error handling
- Added validation error formatting
- Added E.164 phone number validation
