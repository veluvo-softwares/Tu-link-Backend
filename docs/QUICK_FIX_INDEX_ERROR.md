# Quick Fix: Firestore Index Error

## Error Message
```
9 FAILED_PRECONDITION: The query requires an index.
You can create it here: https://console.firebase.google.com/...
```

## Immediate Solution (1 Minute)

### Step 1: Click the URL
Copy the URL from the error message and open it in your browser.

Example:
```
https://console.firebase.google.com/v1/r/project/tulink-app-1a942/firestore/indexes?create_composite=...
```

### Step 2: Click "Create Index"
The Firebase Console will open with the index configuration pre-filled.

### Step 3: Wait for Index Creation
- Status will show "Building" → "Enabled"
- Usually takes 1-5 minutes
- You'll see a green checkmark when ready

### Step 4: Retry Your Request
Once the index shows "Enabled", retry your API call.

## Which Endpoint Requires This?

**Endpoint:** `GET /journeys/active`

**Why:** This endpoint queries all participant records to find active journeys for the current user.

**Query:**
```typescript
collectionGroup('participants')
  .where('userId', '==', userId)
  .where('status', 'in', ['ACTIVE', 'ACCEPTED'])
```

## Alternative: Use Firebase CLI

```bash
# 1. Login to Firebase
firebase login

# 2. Select your project
firebase use tulink-app-1a942

# 3. Deploy the index configuration
firebase deploy --only firestore:indexes

# 4. Wait for deployment to complete
```

The `firestore.indexes.json` file is already configured in the project root.

## Verify Index Creation

### Option 1: Firebase Console
1. Go to https://console.firebase.google.com/
2. Select project: `tulink-app-1a942`
3. Navigate to: **Firestore Database** → **Indexes**
4. Look for index on `participants` collection group
5. Status should be "Enabled" (not "Building")

### Option 2: Firebase CLI
```bash
firebase firestore:indexes
```

Look for:
```
Collection Group: participants
Fields: status (ASCENDING), userId (ASCENDING)
Status: Enabled
```

## Test After Index is Ready

```bash
# Login first
TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}' \
  | jq -r '.data.tokens.idToken')

# Test active journeys endpoint
curl -X GET http://localhost:3000/journeys/active \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:** Should return `200 OK` with an array of active journeys (may be empty if no active journeys).

## Common Issues

### Issue: Still getting the error after creating index
**Cause:** Index is still building
**Solution:** Wait 1-5 more minutes and retry

### Issue: Can't access Firebase Console
**Cause:** Not logged in or no permissions
**Solution:** Ask project owner to:
1. Add you to the Firebase project
2. Grant you "Editor" or "Owner" role

### Issue: Firebase CLI says "No project active"
**Solution:**
```bash
firebase use tulink-app-1a942
```

## For More Details

See the complete guide: [FIRESTORE_INDEX_SETUP.md](./FIRESTORE_INDEX_SETUP.md)

## Summary

✅ **Fastest Fix:** Click the URL in the error message
✅ **Wait Time:** 1-5 minutes for index to build
✅ **One-Time Setup:** Only needs to be done once per project
✅ **Automated Deployment:** Use `firebase deploy --only firestore:indexes`
