# Auth Flow Troubleshooting Guide

## Quick Diagnosis Matrix

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 401 after signin, but localStorage has token | Supabase session not persisted to cookies | ✅ FIXED - Browser client now has cookie handlers |
| Browser DevTools shows no auth cookies | Browser client can't read/write cookies | ✅ FIXED - Cookie handlers now configured |
| authFetch() fails with 401 | Token validation fails on server | Check token is valid in localStorage and in cookies |
| Blank page after /auth/callback redirect | Session extraction failed | Check browser console for errors in auth callback |
| "Please sign in" message after signin | Role check returned null | Check /api/admin/check response includes user data |

---

## Step-by-Step Debug Checklist

### 1. Sign-In Flow (OAuth -> Callback)

```
✓ 1. User navigates to /auth/signin
✓ 2. Click sign-in button → redirects to Supabase
✓ 3. Complete OAuth (email/magic link/Google/etc)
✓ 4. Redirected back to /auth/callback?code=xxx
✓ 5. Browser callback page extracts session
✓ 6. Stores auth data in localStorage + cookies
✓ 7. Redirects to dashboard/admin/onboarding
```

**Check in DevTools → Network:**
- GET /auth/signin - 200 ✓
- GET /auth/callback?code=... - 200 ✓
- POST /api/admin/check - 200 ✓
- Redirect to next page - 200 ✓

### 2. Verify Cookies Are Being Set

**In DevTools → Application → Cookies:**

Should see one of these Supabase session cookies:
```
sb-[project-id]-auth-token         (Session token)
sb-[project-id]-auth-token-code-verifier  (OAuth code verifier)
```

**If missing:**
- Browser client doesn't have cookie handlers ❌ (SHOULD BE FIXED NOW)
- Cookies are being blocked (check Privacy > Site Settings)
- Browser is in private/incognito mode (won't persist cookies)

### 3. Verify localStorage Is Being Set

**In DevTools → Application → Local Storage:**

Should see:
```
boka_auth_access_token       (JWT token)
boka_auth_user_data          (JSON user info)
boka_auth_tenant_id          (Current tenant)
boka_auth_role               (User role)
boka_auth_is_admin           (Admin flag)
```

**If missing:**
- storeSignInData() wasn't called
- localStorage is being blocked
- Session extraction failed (check console errors)

### 4. Test API Call with Token

**In Browser Console:**

```javascript
// Check token exists
const token = localStorage.getItem('boka_auth_access_token');
console.log('Token exists:', !!token);
console.log('Token length:', token?.length);

// Try a simple API call
const res = await fetch('/api/admin/check', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ email: 'user@example.com' })
});
const data = await res.json();
console.log('Response:', res.status, data);
```

**If 401:**
- Token is missing or invalid
- Check if it matches what's in cookies
- Try clearing cookies and signing in again

---

## Common Issues & Solutions

### Issue 1: "Authorization header is missing or malformed"

**Cause:** Component not using `authFetch()`, using plain `fetch()` instead

**Solution:** 
```typescript
// WRONG:
const res = await fetch('/api/admin/settings', { method: 'GET' });

// RIGHT:
import { authFetch } from '@/lib/auth/auth-api-client';
const res = await authFetch('/api/admin/settings', { method: 'GET' });
```

**Files to check:**
- Any component calling `/api/admin/*` routes
- Search for plain `fetch()` calls in src/components/

### Issue 2: "Session not found" or "No active session"

**Cause:** Browser client can't read session from cookies

**Solution:** 
```typescript
// Verify browser client has cookie handlers
// File: src/lib/supabase/client.ts
// Should have:
createBrowserClient(url, key, {
  cookies: {
    get: (name) => { ... },
    set: (name, value, options) => { ... },
    remove: (name, options) => { ... },
  },
});
```

### Issue 3: Blank Page After Sign-In

**Cause:** Error in callback page redirect logic

**Solution:**
1. Open DevTools → Console
2. Look for errors like "Cannot read property 'user' of null"
3. Check if /api/admin/check is returning the expected structure:
   ```json
   { "found": { "admin": true|false, "tenant_id": "...", "role": "..." } }
   ```

### Issue 4: "Please sign in" Message After Signing In

**Cause:** Role check failed or tenant not found

**Solution:**
1. Check /api/admin/check response in Network tab
2. Should have `found` with tenant_id and role
3. Verify database:
   ```sql
   -- Check admin
   SELECT * FROM admins WHERE email = 'user@example.com';
   
   -- OR check tenant_users
   SELECT * FROM tenant_users WHERE email = 'user@example.com';
   ```

---

## Testing Cookies vs localStorage

### Test 1: Disable localStorage

```javascript
// In console:
Object.defineProperty(window, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
});
// Try API call - should still work if cookies are valid
```

### Test 2: Disable cookies

```javascript
// Clear cookies:
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
// Sign out and sign in again
// authFetch will fail because token only in localStorage is not validated
```

---

## Performance Debugging

### Check Auth Performance in Network Tab

Ideal timings:
```
GET /auth/signin              50ms  (quick page load)
GET /auth/callback?code=...   200-500ms  (OAuth verification time)
POST /api/admin/check         100-200ms  (database lookup)
GET /dashboard                100-300ms  (page load)
GET /api/admin/data           100-200ms  (subsequent API call)
```

**If POST /api/admin/check is slow (>1000ms):**
- Check database indexes on email column in admins and tenant_users tables
- Check if Supabase is responsive
- Check network tab for slow query

---

## Security Checks

### Verify Secure Cookies

```javascript
// In console, after signing in:
document.cookie; // Should include sb-xxx-auth-token

// Check cookie attributes:
// Should have: Secure (HTTPS only), HttpOnly (JS can't read), SameSite=Lax
```

### Verify Token Expiry

```javascript
// Decode JWT (don't rely on this - just for inspection):
const token = localStorage.getItem('boka_auth_access_token');
const parts = token.split('.');
const decoded = JSON.parse(atob(parts[1]));
console.log('Token expires:', new Date(decoded.exp * 1000));
console.log('Is expired:', Date.now() > decoded.exp * 1000);
```

---

## When to Use Each Store

| Use Case | Storage | Why |
|----------|---------|-----|
| Persist session across browser restarts | Cookies (httpOnly) | Not accessible to JS, more secure |
| Access token in client-side code | localStorage | Can't use httpOnly in JS |
| Tenant context in components | localStorage | Easy to read in React |
| Server validation of auth | Cookies (session) | Set by middleware, validated on server |

---

## Rollback: If Something Goes Wrong

1. **Revert browser client:**
   ```typescript
   // Remove cookie handlers from createBrowserClient
   browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
   ```

2. **Fallback: Use server-side only:**
   - Remove localStorage dependency
   - Use server components with cookies
   - Add middleware to check session

3. **Emergency: Clear all data:**
   ```javascript
   // Browser console:
   localStorage.clear();
   document.cookie.split(";").forEach(c => {
     document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
   });
   // Refresh page and sign in again
   ```

---

## Getting Help

If you're still seeing issues after the fix:

1. **Check the console for errors:**
   - DevTools → Console (filter for [auth/callback], [AuthAPIClient])
   - Copy full error message

2. **Verify the fix was applied:**
   - File: src/lib/supabase/client.ts
   - Should have `cookies: { get, set, remove }` in createBrowserClient

3. **Check Supabase status:**
   - supabase.com/status
   - Verify project URL and anon key are correct

4. **Test with minimal code:**
   ```typescript
   // Try directly in browser console:
   import { getSupabaseBrowserClient } from '@/lib/supabase/client';
   const sb = getSupabaseBrowserClient();
   const { data } = await sb.auth.getSession();
   console.log('Session:', data?.session);
   ```

---

## Next Steps

After confirming the fix works:

1. ✅ Test full sign-in flow
2. ✅ Verify 401 errors are gone
3. ✅ Check all components using authFetch properly
4. ✅ Monitor production for any auth issues
5. ✅ Consider adding auth error boundary component

See `AUTH_SYSTEM_COMPREHENSIVE_GUIDE.md` for deeper dive into architecture.
