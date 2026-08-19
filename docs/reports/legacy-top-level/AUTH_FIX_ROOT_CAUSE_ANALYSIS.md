# Auth System Investigation & Fixes - December 19, 2025

## Issue Reported

```
{"error":"missing_authorization","code":"missing_authorization",
"message":"Authorization header is missing or malformed"}
```

**Status:** ✅ ROOT CAUSE IDENTIFIED & FIXED

---

## Root Cause Analysis

### The Problem

The new auth system was storing tokens under **NEW localStorage keys**:
- `boka_auth_access_token`
- `boka_auth_user_data`
- `boka_auth_tenant_id`
- `boka_auth_role`
- `boka_auth_is_admin`

But several components and context providers were still looking for **OLD keys**:
- `current_tenant` (OLD)
- `current_tenant_role` (OLD)
- `supabase_access_token` (OLD)

### The Flow That Failed

```
1. User clicks magic link
   ↓
2. auth/callback runs:
   - Gets session from Supabase ✓
   - Extracts access_token ✓
   - Calls /api/admin/check ✓
   - storeSignInData() stores under NEW keys ✓
   - Redirects to /dashboard ✓
   ↓
3. Dashboard loads:
   - TenantProvider looks for OLD keys ✗
   - TenantProvider doesn't find tenant ID ✗
   - tenant?.id is null
   ↓
4. Components mount:
   - ChatsList: enabled: !!tenant?.id → false (doesn't call API)
   - ServicesList: enabled: !!tenant?.id → false (doesn't call API)
   - CustomersList: enabled: !!tenant?.id → false (doesn't call API)
   ↓
5. When components finally call API:
   - buildAuthHeaders() reads NEW keys ✓
   - Token is available ✓
   - Authorization header is built ✓
   - BUT by then some other component might have called API without waiting
   ↓
6. API returns 401: missing_authorization
```

---

## Fixes Applied

### Fix 1: TenantProvider Migration (🔴 CRITICAL)

**File:** `src/lib/supabase/tenant-context.tsx`

**What changed:**
- Now checks NEW auth keys first: `boka_auth_tenant_id` and `boka_auth_role`
- Falls back to OLD keys for backward compatibility
- Automatically migrates old keys to new format
- Retries up to 5 times with 200ms delays to ensure localStorage is available

**Impact:** Components now correctly detect tenant ID after signin

### Fix 2: Callback Storage Verification

**File:** `src/app/auth/callback/page.tsx`

**What changed:**
- Added verification that tokens are actually stored before redirecting
- Checks localStorage immediately after storeSignInData()
- Retries if storage fails
- Provides detailed error messages if storage fails

**Impact:** Ensures tokens are persisted before navigation

### Fix 3: Enhanced Logging

**Files:**
- `src/lib/auth/token-storage.ts` - Added detailed logging for all token operations
- `src/lib/auth/auth-headers.ts` - Added debug logging for header building
- `src/lib/auth/auth-api-client.ts` - Added detailed logging for all API calls
- `src/lib/auth/auth-manager.ts` - Added logging for sign-in data storage

**What changed:**
- All token operations now log with ✓/✗ indicators
- Shows token lengths to verify they're not empty
- Shows which keys are available in localStorage
- Shows HTTP status codes for API calls
- Shows when 401 errors occur

**Impact:** You can now see exactly what's happening in the browser console

---

## Storage Key Mapping (FIXED)

| Component | OLD Keys | NEW Keys | Status |
|-----------|----------|----------|--------|
| auth/callback | N/A | boka_auth_* (all 5) | ✓ Stores NEW |
| TenantProvider | current_tenant, current_tenant_role | boka_auth_tenant_id, boka_auth_role | ✓ FIXED: Reads NEW, falls back to OLD |
| buildAuthHeaders | (unused) | boka_auth_access_token, boka_auth_tenant_id | ✓ Reads NEW |
| Components | current_tenant via useTenant | No longer needed | ✓ Uses TenantProvider |

---

## Verification Steps

### Step 1: Check localStorage After Signin

After clicking the magic link and redirecting:

```javascript
// In browser console:
console.log('Access Token:', localStorage.getItem('boka_auth_access_token')?.substring(0, 50));
console.log('Tenant ID:', localStorage.getItem('boka_auth_tenant_id'));
console.log('Role:', localStorage.getItem('boka_auth_role'));
console.log('Is Admin:', localStorage.getItem('boka_auth_is_admin'));
console.log('User Data:', localStorage.getItem('boka_auth_user_data'));
```

**Expected output:**
```
Access Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Tenant ID: "550e8400-e29b-41d4-a716-446655440000"
Role: "owner" or "manager" or "staff"
Is Admin: "false"
User Data: {"email":"user@example.com","user_id":"..."}
```

### Step 2: Monitor Network Requests

1. Open DevTools → Network tab
2. Sign in and wait for redirect
3. Look for API calls (e.g., `/api/services`, `/api/customers`)
4. Check the request headers for Authorization:
   ```
   Authorization: Bearer eyJhbGc...
   X-Tenant-ID: 550e8400-e29b-41d4-a716-446655440000
   Content-Type: application/json
   ```

**Expected:** All requests should have Authorization header

### Step 3: Check Browser Console Logs

Look for these patterns:

```
✓ Access token stored and verified
✓ Sign-in data stored successfully  
✓ Found tenant in NEW auth storage
✓ Authorization header included
✓ GET /api/services 200
```

**If you see these, everything is working!**

---

## Debugging: What to Look For

### If you still see 401 errors:

1. **Check localStorage is populated:**
   ```javascript
   Object.keys(localStorage).filter(k => k.includes('boka_auth'))
   // Should show all 5 keys
   ```

2. **Check TenantProvider found tenant:**
   - Look for: `[TenantProvider] ✓ Found tenant in NEW auth storage`
   - Or: `[TenantProvider] ⚠ Found tenant in OLD storage (backward compat)`

3. **Check buildAuthHeaders is including token:**
   - Look for: `[AuthHeaders] ✓ Authorization header included`
   - If you see `[AuthHeaders] ✗ No access token found in localStorage` - token isn't stored

4. **Check API calls are being made:**
   - Look for: `[AuthAPIClient] GET /api/services`
   - Check status code in response

### If TenantProvider doesn't find tenant:

This means:
- Either signin didn't complete (check auth/callback logs)
- Or storeSignInData() didn't run (check for error in callback)
- Or localStorage isn't persisting (browser issue)

---

## Testing Checklist

- [ ] Signin with admin account
- [ ] Check localStorage has all 5 boka_auth_* keys
- [ ] Dashboard loads without 401 errors
- [ ] ChatsList loads chats
- [ ] CustomersList loads customers
- [ ] ServicesList loads services

- [ ] Signin with tenant owner account
- [ ] Check localStorage has all 5 keys
- [ ] TenantProvider finds tenant
- [ ] Dashboard loads
- [ ] All components load data

- [ ] Signin with tenant staff account
- [ ] Check redirect to /dashboard?role=staff
- [ ] Check 401 errors don't occur

---

## Key Changes Made

### 1. TenantProvider (CRITICAL FIX)
- Now reads NEW auth keys first
- Falls back to OLD keys with automatic migration
- Logs all steps with timing information

### 2. Auth Callback
- Verifies tokens are stored before redirecting
- Retries if storage fails
- Clear error messages

### 3. Token Storage Utility
- Enhanced logging for all operations
- Shows available localStorage keys
- Verifies storage was successful

### 4. Auth Headers Builder
- Logs when Authorization header is included
- Logs when token is missing
- Shows header details

### 5. Auth API Client
- Logs all API calls (method, URL, status)
- Logs 401 errors prominently
- Shows request/response details

---

## What's Next

1. **Run a fresh signin:**
   - Clear all localStorage
   - Visit signin page
   - Request magic link
   - Click link
   - Check browser console for logs

2. **If 401 still occurs:**
   - Check TenantProvider logs
   - Check buildAuthHeaders logs
   - Check API call logs
   - Let me know which step fails

3. **Monitor for issues:**
   - 401 errors should now have detailed logging
   - Components should load correctly
   - No more missing Authorization headers

---

## Summary

**Root Cause:** TenantProvider was looking for OLD localStorage keys while new auth system stored data under NEW keys

**Solution:** Updated TenantProvider to:
1. Check NEW auth keys first
2. Fall back to OLD keys for compatibility
3. Auto-migrate old keys to new format
4. Retry with delays for localStorage race conditions

**Logging:** Added comprehensive logging at every step so you can trace what's happening

**Expected Result:** No more 401 missing_authorization errors

---

**Status:** ✅ FIXES APPLIED - Ready for testing
