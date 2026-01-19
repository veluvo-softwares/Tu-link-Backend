# Firestore Index Setup Guide

## Overview

Firestore requires composite indexes for certain queries, especially when:
- Using collection group queries
- Filtering on multiple fields
- Using inequality operators or `in` operator on multiple fields
- Combining sorting and filtering

## Current Index Requirements

### Active Journeys Query

**Query Location:** `src/modules/journey/journey.service.ts:219-224`

**Query:**
```typescript
this.firebaseService.firestore
  .collectionGroup('participants')
  .where('userId', '==', userId)
  .where('status', 'in', ['ACTIVE', 'ACCEPTED'])
  .get();
```

**Why Index is Needed:**
- Collection group query across all `participants` subcollections
- Multiple field filters (`userId` and `status`)
- Using `in` operator which requires indexing

## Solution Options

### Option 1: Create Index via Firebase Console (Quick)

1. **Click the URL in the error message** (recommended for quick fix)

   The error contains a direct link to create the index:
   ```
   https://console.firebase.google.com/v1/r/project/tulink-app-1a942/firestore/indexes?create_composite=...
   ```

2. **Click "Create Index"** in the Firebase Console

3. **Wait for index creation** (can take a few minutes)

4. **Retry the request** once the index shows as "Enabled"

### Option 2: Create Index via Firebase CLI (Automated)

**Prerequisites:**
```bash
npm install -g firebase-tools
firebase login
```

**Steps:**

1. **Initialize Firebase in your project** (if not already done):
   ```bash
   firebase init firestore
   ```

   - Select your Firebase project (`tulink-app-1a942`)
   - Accept default for Firestore rules file
   - Accept default for Firestore indexes file

2. **The `firestore.indexes.json` file is already created** in the project root

3. **Deploy the indexes**:
   ```bash
   firebase deploy --only firestore:indexes
   ```

4. **Wait for deployment** to complete

5. **Check index status**:
   ```bash
   firebase firestore:indexes
   ```

### Option 3: Manual Index Creation via Console

1. **Go to Firebase Console**
   - Navigate to: https://console.firebase.google.com/
   - Select project: `tulink-app-1a942`
   - Go to **Firestore Database** → **Indexes** tab

2. **Click "Create Index"**

3. **Configure the composite index:**
   - **Collection group:** `participants`
   - **Fields to index:**
     - Field: `status`, Order: `Ascending`
     - Field: `userId`, Order: `Ascending`
   - **Query scope:** `Collection group`

4. **Click "Create"**

5. **Wait for index build** (status will change from "Building" to "Enabled")

## Index Configuration File

The project includes a `firestore.indexes.json` file with the required index definition:

```json
{
  "indexes": [
    {
      "collectionGroup": "participants",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
```

## Verification

After creating the index, verify it works:

```bash
# Login first
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Extract token and test active journeys endpoint
TOKEN="<your-id-token>"

curl -X GET http://localhost:3000/journeys/active \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": []
}
```

## Troubleshooting

### Issue: Index still building

**Symptom:** Same error appears even after creating index

**Solution:**
- Check index status in Firebase Console
- Wait until status shows "Enabled" (not "Building")
- For large collections, this can take several minutes

### Issue: Firebase CLI not finding project

**Symptom:** `Error: No project active`

**Solution:**
```bash
# Set the active project
firebase use tulink-app-1a942

# Or initialize if needed
firebase init
```

### Issue: Permission denied when deploying indexes

**Symptom:** `Error: HTTP Error: 403, Permission denied`

**Solution:**
- Ensure you're logged in: `firebase login`
- Verify you have Editor/Owner role in the Firebase project
- Check you selected the correct project: `firebase projects:list`

## Additional Indexes (Future)

As the application grows, you may need additional indexes for:

### Journey Queries
```json
{
  "collectionId": "journeys",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "leaderId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

### Location Queries (if using geoqueries)
```json
{
  "collectionId": "locations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "journeyId", "order": "ASCENDING" },
    { "fieldPath": "timestamp", "order": "DESCENDING" }
  ]
}
```

## Best Practices

1. **Use Index Configuration File**
   - Keep `firestore.indexes.json` in version control
   - Deploy indexes as part of CI/CD pipeline
   - Document why each index is needed

2. **Monitor Index Usage**
   - Check Firebase Console for unused indexes
   - Remove indexes that are no longer needed
   - Indexes cost storage and write performance

3. **Development vs Production**
   - Use emulator for local development (no indexes needed)
   - Deploy indexes to staging before production
   - Test queries thoroughly before deploying

4. **Index Limits**
   - Firestore has limits on number of indexes per project
   - Each index increases write cost
   - Consider query design to minimize index requirements

## Alternative Query Design (No Index Required)

If you want to avoid creating indexes, you can refactor the query:

### Current Query (Requires Index)
```typescript
// Queries all participants matching conditions
this.firebaseService.firestore
  .collectionGroup('participants')
  .where('userId', '==', userId)
  .where('status', 'in', ['ACTIVE', 'ACCEPTED'])
  .get();
```

### Alternative: Two Separate Queries (No Index)
```typescript
// Query 1: Get ACTIVE participants
const activeSnapshot = await this.firebaseService.firestore
  .collectionGroup('participants')
  .where('userId', '==', userId)
  .where('status', '==', 'ACTIVE')
  .get();

// Query 2: Get ACCEPTED participants
const acceptedSnapshot = await this.firebaseService.firestore
  .collectionGroup('participants')
  .where('userId', '==', userId)
  .where('status', '==', 'ACCEPTED')
  .get();

// Merge results
const allDocs = [...activeSnapshot.docs, ...acceptedSnapshot.docs];
```

**Trade-offs:**
- ✅ No index required
- ✅ Works immediately
- ❌ Two database queries instead of one
- ❌ Slightly higher latency
- ❌ Uses more read quota

## Recommended Approach

**For Production:** Use Option 1 (Click the error URL) or Option 2 (Firebase CLI)
- Creates proper indexes
- Best performance
- Scalable solution

**For Quick Testing:** Use the alternative query design
- No setup required
- Works immediately
- Good for prototyping

## Summary

✅ **Immediate Fix:** Click the URL in the error message to auto-create the index
✅ **Automated Deployment:** Use `firebase deploy --only firestore:indexes`
✅ **Index File:** `firestore.indexes.json` is ready for deployment
✅ **Verification:** Test with `GET /journeys/active` after index is enabled

**Index Creation Time:** Usually 1-5 minutes, can be longer for large collections.
