# Auth System - Testing Steps With Enhanced Logging

## What Changed

I've added detailed logging throughout the auth system to help diagnose exactly where the 401 error is coming from.

---

## Test Steps

### Step 1: Clear Everything
```javascript
// In DevTools Console:
localStorage.clear();
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
location.reload();
```

### Step 2: Open DevTools Console BEFORE Signing In
- Press F12 to open DevTools
- Go to Console tab
- Keep it open

### Step 3: Sign In
1. Go to `/auth/signin`
2. Click "Sign In"
3. Complete OAuth

### Step 4: Watch the Logs
As the callback page loads, you should see logs like:

**Expected Logs (in this order):**

```
[auth/callback] About to fetch session...
[auth/callback] Extracted session data
[auth/callback] Calling POST /api/admin/check
[auth/callback] Admin check returned 200
[auth/callback] Storing auth data: {
  hasAccessToken: true,
  accessTokenLength: 987,
  hasAdmin: false,
  hasTenantId: true,
  hasRole: true,
  email: "user@example.com"
}
[auth/callback] IMMEDIATE VERIFICATION after storeSignInData: {
  tokenStored: true,
  userDataStored: true,
  tenantIdStored: true,
  tokenLength: 987
}
[auth/callback] Redirecting to: /dashboard
```

**Problem Logs (if you see these):**

```
[auth/callback] Session error: ...
[auth/callback] No active session found
[auth/callback] No access token in session
[auth/callback] Admin check failed
[auth/callback] IMMEDIATE VERIFICATION ... tokenStored: false  ← PROBLEM!
```

---

### Step 5: Check Dashboard Load Logs

After redirect to /dashboard, look for:

**If Dashboard Loads Correctly:**
```
[DashboardLayoutContent] ✓ Auth token found, children ready to render
[TenantProvider] ✓ Found tenant in NEW auth storage
[TenantProvider] Tenant ID: t_abc123
[TenantProvider] Role: owner
[fetchWithAuth] Building headers for: /api/chats?tenant_id=t_abc123
[fetchWithAuth] Auth header present: true
[fetchWithAuth] Tenant header present: true
```

**If 401 Error Occurs:**
```
[DashboardLayoutContent] ✓ Auth token found, children ready to render
[TenantProvider] ✓ Found tenant in NEW auth storage
[fetchWithAuth] Building headers for: /api/chats?tenant_id=t_abc123
[fetchWithAuth] Auth header present: true
[fetchWithAuth] Tenant header present: true
[fetchWithAuth] Response: 401 missing_authorization  ← SERVER ERROR
```

OR:

```
[fetchWithAuth] Auth header present: false ← TOKEN NOT FOUND!
[fetchWithAuth] ⚠️ NO AUTHORIZATION HEADER - token not in localStorage?
[fetchWithAuth] Token exists in localStorage: false
```

---

## Diagnosis Guide

### If you see "tokenStored: false" after storeSignInData

**Cause:** The token wasn't actually stored, or localStorage is not accessible

**What to check:**
1. Is localStorage allowed in browser settings?
2. Are you in Private/Incognito mode?
3. Check error messages in console (look for "localStorage" errors)

**Quick test:**
```javascript
// In console:
localStorage.setItem('test', 'value');
console.log(localStorage.getItem('test'));  // Should print: value
```

### If you see "Auth header present: false"

**Cause:** Token is NOT in localStorage even though dashboard loaded

**What to check:**
```javascript
// Check what's actually in localStorage:
const token = localStorage.getItem('boka_auth_access_token');
console.log('Token:', token);
console.log('Token length:', token?.length);
console.log('All keys:', Object.keys(localStorage));
```

**Next step:** 
- Sign in again and watch the "IMMEDIATE VERIFICATION" logs
- If token shows as stored but then disappears, localStorage is being cleared

### If you see "Auth header present: true" but 401 response

**Cause:** Server can't validate the token

**What to check:**
1. Look at Network tab → the failing API request → Response tab
2. What does the error say? Examples:
   - "invalid_token" = Token signature wrong
   - "token_expired" = Token is old
   - "user_not_found" = User not in database
   - "missing_authorization" = Header not sent (but we saw it was)

**If "invalid_token":**
```javascript
// Check token details:
const token = localStorage.getItem('boka_auth_access_token');
const parts = token.split('.');
const payload = JSON.parse(atob(parts[1]));
console.log('Token details:', {
  sub: payload.sub,
  email: payload.email,
  aud: payload.aud,
  exp: new Date(payload.exp * 1000)
});
```

---

## Log Output Locations

### The Console Will Show Logs From:

1. **[auth/callback]** - Callback page processing
2. **[auth/callback] IMMEDIATE VERIFICATION** - Storage verification
3. **[DashboardLayoutContent]** - Dashboard layout checking for auth
4. **[TenantProvider]** - Tenant context loading
5. **[AuthHeaders]** - Header building
6. **[fetchWithAuth]** - API request execution
7. **[AuthAPIClient]** - Final fetch execution

Track these logs in order to see where it breaks.

---

## Expected Full Flow

```
Sign-In Click
    ↓
[auth/callback] Starting OAuth callback...
    ↓
[auth/callback] Extracted session data ✓
    ↓
POST /api/admin/check (200)
    ↓
[auth/callback] Storing auth data ✓
    ↓
[auth/callback] IMMEDIATE VERIFICATION: tokenStored: true ✓
    ↓
Redirect to /dashboard
    ↓
[DashboardLayoutContent] ✓ Auth token found ✓
    ↓
[TenantProvider] ✓ Found tenant ✓
    ↓
[fetchWithAuth] Building headers ✓
    ↓
[fetchWithAuth] Auth header present: true ✓
    ↓
API Response: 200 ✓
    ↓
Dashboard displays data ✓
```

---

## What to Report

If you're still seeing 401 errors, run through the tests above and tell me:

1. **Callback logs:** Do you see "IMMEDIATE VERIFICATION: tokenStored: true"?
2. **Dashboard logs:** Do you see "Auth token found"?
3. **Auth headers:** Do you see "Auth header present: true"?
4. **API response:** Is it 401 or a different error?
5. **Any error messages** that appear in the console

---

## Testing Commands

### Quick Test in Console (After Sign-In):

```javascript
// Verify localStorage
console.log('=== Storage Check ===');
console.log('Token:', !!localStorage.getItem('boka_auth_access_token'));
console.log('Tenant:', localStorage.getItem('boka_auth_tenant_id'));
console.log('Role:', localStorage.getItem('boka_auth_role'));

// Test buildAuthHeaders
console.log('\n=== Header Check ===');
const headers = (await import('/src/lib/auth/auth-headers.ts')).buildAuthHeaders();
console.log('Headers:', headers);
console.log('Has Authorization:', !!headers.Authorization);

// Test authFetch
console.log('\n=== API Call Test ===');
const res = await (await import('/src/lib/auth/auth-api-client.ts')).authFetch('/api/admin/check', {
  method: 'POST',
  body: { email: 'test@example.com' }
});
console.log('Response:', res);
```

---

## Next Steps

1. **Run the tests above** and watch the console logs
2. **Screenshot or copy the logs** where the issue appears
3. **Tell me:** 
   - Where do the logs stop?
   - What's the last successful log message?
   - What error appears (if any)?

With the enhanced logging, we'll be able to pinpoint exactly where the auth flow is breaking!
