# Auth Debug Diagnostic

## Quick Diagnosis Steps

### Step 1: Check DevTools Console for These Messages

After signing in and the callback completes, open DevTools → Console and look for:

```
[DashboardLayoutClient] ✓ Auth token found, children ready to render
```

**If you see this:** Auth token WAS found ✓

**If you DON'T see this:** Auth token was NOT found ✗

---

### Step 2: Check Storage

**In DevTools → Application → Local Storage**, verify these keys exist:

```
boka_auth_access_token       ← MUST be present
boka_auth_user_data
boka_auth_tenant_id
boka_auth_role
boka_auth_is_admin
```

If any are MISSING, the callback didn't store them properly.

---

### Step 3: Check Cookies

**In DevTools → Application → Cookies**, look for:

```
sb-[project-id]-auth-token   ← Session cookie from Supabase
```

If this is MISSING, the browser client cookie handlers aren't working.

---

### Step 4: Run This in Console

```javascript
// Copy paste into DevTools Console:

console.log('=== AUTH DEBUG ===');

// Check token
const token = localStorage.getItem('boka_auth_access_token');
console.log('Token in localStorage:', !!token);
if (token) {
  console.log('Token first 50 chars:', token.substring(0, 50));
  console.log('Token length:', token.length);
}

// Check tenant
const tenantId = localStorage.getItem('boka_auth_tenant_id');
console.log('Tenant ID:', tenantId);

// Check cookies
const cookieStr = document.cookie;
const hasSBCookie = cookieStr.includes('sb-');
console.log('Has SB auth cookie:', hasSBCookie);
if (hasSBCookie) {
  console.log('Cookies:', cookieStr.substring(0, 100) + '...');
}

// Test buildAuthHeaders
const { buildAuthHeaders } = await import('/src/lib/auth/auth-headers.ts');
const headers = buildAuthHeaders();
console.log('Authorization header:', headers.Authorization ? 'YES' : 'NO');
console.log('Headers object:', headers);

console.log('=== END DEBUG ===');
```

---

### Step 5: Check Network Requests

**In DevTools → Network tab**, look at one of the failing requests to `/api/*`:

1. Click on the request
2. Go to "Headers" tab
3. Look for **Request Headers** section
4. Check if `Authorization: Bearer ...` is present

**If missing:** authFetch() isn't adding the header  
**If present:** authFetch() is working, so the issue is server-side validation

---

### Step 6: Check Server Logs

Look at your Next.js terminal for any error messages like:

```
[route-handler] Auth check for GET /api/... authHeader: MISSING
[route-handler] Invalid token
[Supabase] Failed to verify user
```

These logs tell you exactly which auth step failed.

---

## Most Likely Causes & Fixes

### Cause 1: Token NOT in localStorage

**Symptom:**
- Console shows: `Token in localStorage: false`
- localStorage has no `boka_auth_access_token`

**Why It Happens:**
- OAuth callback didn't complete
- `/api/admin/check` failed
- `storeSignInData()` wasn't called

**Fix:**
```javascript
// In auth/callback/page.tsx, add this debug log:
console.log('[auth/callback] About to store data:', {
  accessToken: accessToken ? 'YES' : 'NO',
  email: email ? 'YES' : 'NO',
  found: found ? 'YES' : 'NO'
});
storeSignInData({...});
console.log('[auth/callback] After storage, checking...');
const verify = localStorage.getItem('boka_auth_access_token');
console.log('[auth/callback] Token now in storage:', !!verify);
```

### Cause 2: Browser Client Cookies Not Working

**Symptom:**
- Console shows: `Has SB auth cookie: false`
- Cookies tab shows no `sb-xxx-auth-token`

**Why It Happens:**
- Browser client doesn't have cookie handlers (SHOULD be fixed now)
- Cookies blocked in browser settings
- Private/Incognito mode

**Fix:**
Verify `src/lib/supabase/client.ts` has:
```typescript
browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  cookies: {
    get: (name) => { ... },
    set: (name, value, options) => { ... },
    remove: (name, options) => { ... }
  }
});
```

### Cause 3: Authorization Header Not Being Added

**Symptom:**
- Console shows: `Authorization header: NO`
- Network tab shows request with NO Authorization header

**Why It Happens:**
- `buildAuthHeaders()` returns empty object
- Token exists but `getStoredAccessToken()` returns null
- `authFetch()` not being used (using plain `fetch()` instead)

**Fix:**
```bash
# Search for plain fetch() calls to /api/
grep -r "fetch(" src/components/ | grep -i "/api/"

# Should return NOTHING. If it returns results, change them to authFetch()
```

### Cause 4: Server Validation Failing

**Symptom:**
- Console shows: `Authorization header: YES`
- Network tab shows Authorization header IS present
- But response is 401

**Why It Happens:**
- Token is invalid (expired or corrupted)
- Supabase can't verify the token signature
- Session state is incomplete (missing cookies)

**Fix:**
```javascript
// Decode and check token validity:
const token = localStorage.getItem('boka_auth_access_token');
const parts = token.split('.');
const header = JSON.parse(atob(parts[0]));
const payload = JSON.parse(atob(parts[1]));
console.log('Token header:', header);
console.log('Token payload:', payload);
console.log('Token exp:', new Date(payload.exp * 1000));
console.log('Is expired:', Date.now() > payload.exp * 1000);
```

---

## Complete Debug Script

Copy this entire script into DevTools Console:

```javascript
console.group('🔍 COMPLETE AUTH DEBUG');

try {
  // 1. Check localStorage
  console.group('localStorage Keys');
  const keys = [
    'boka_auth_access_token',
    'boka_auth_user_data',
    'boka_auth_tenant_id',
    'boka_auth_role',
    'boka_auth_is_admin',
  ];
  keys.forEach(key => {
    const val = localStorage.getItem(key);
    console.log(`  ${key}: ${val ? '✓' : '✗'}`);
  });
  console.groupEnd();

  // 2. Check cookies
  console.group('Cookies');
  const hasSB = document.cookie.includes('sb-');
  console.log(`  Has SB auth cookie: ${hasSB ? '✓' : '✗'}`);
  console.groupEnd();

  // 3. Check token validity
  console.group('Token Details');
  const token = localStorage.getItem('boka_auth_access_token');
  if (token) {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      const expiresAt = new Date(payload.exp * 1000);
      const isExpired = Date.now() > payload.exp * 1000;
      console.log(`  Token valid: ${!isExpired ? '✓' : '✗'}`);
      console.log(`  Expires: ${expiresAt.toLocaleString()}`);
      console.log(`  User: ${payload.email || payload.sub}`);
    }
  } else {
    console.log('  No token found ✗');
  }
  console.groupEnd();

  // 4. Check API call capability
  console.group('API Call Test');
  const testRes = await (async () => {
    try {
      const res = await fetch('/api/admin/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'missing'}`,
        },
        body: JSON.stringify({ email: 'test@example.com' })
      });
      return {
        status: res.status,
        ok: res.ok
      };
    } catch (e) {
      return { error: e.message };
    }
  })();
  console.log('  Test result:', testRes);
  console.groupEnd();

} catch (e) {
  console.error('Debug script error:', e);
}

console.groupEnd();
```

---

## What to Report

If you're still seeing 401 errors after the fixes, run the complete debug script above and tell me:

1. **localStorage keys:** Which ones are present/missing?
2. **Cookies:** Is `sb-xxx-auth-token` present?
3. **Token validity:** Is the token expired?
4. **API test result:** What status code did it return?
5. **Console logs:** Any `[AuthHeaders] ✗ No access token found` messages?
6. **Network tab:** Is Authorization header present on failing request?

With this information, we can pinpoint exactly where the auth flow is breaking.
