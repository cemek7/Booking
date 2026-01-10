# Auth System - Quick Start Testing Guide

## What Was Fixed

✅ **Fix #1:** 4 components now use `authFetch()` instead of plain `fetch()`  
✅ **Fix #2:** Browser Supabase client now has cookie handlers configured  

**Result:** OAuth sessions persist, tokens validate correctly, no more 401 errors.

---

## Quick Test (5 minutes)

### Step 1: Clear Everything
```javascript
// Open DevTools (F12) → Console and run:

// Clear localStorage
localStorage.clear();

// Clear cookies
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});

// Refresh page
location.reload();
```

### Step 2: Sign In
1. Navigate to `/auth/signin`
2. Click "Sign In"
3. Complete OAuth (magic link/Google/etc)
4. Wait for redirect to dashboard

### Step 3: Verify Cookies Are Set
```javascript
// In DevTools Console:
console.log('Cookies:', document.cookie);

// Should output something like:
// Cookies: sb-[project-id]-auth-token=eyJ...
```

**✓ PASS:** See `sb-[project-id]-auth-token`  
**✗ FAIL:** No cookies shown → Session didn't persist

### Step 4: Verify localStorage Is Set
```javascript
// In DevTools Console:
console.log('Auth Token:', localStorage.getItem('boka_auth_access_token')?.substring(0, 50) + '...');
console.log('User Data:', localStorage.getItem('boka_auth_user_data'));

// Should output something like:
// Auth Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey...
// User Data: {"tenant_id":"t_123","role":"owner",...}
```

**✓ PASS:** Both keys present  
**✗ FAIL:** Missing one or both → storeSignInData wasn't called

### Step 5: Test API Call
```javascript
// In DevTools Console:
const res = await authFetch('/api/admin/check', {
  method: 'POST',
  body: { email: localStorage.getItem('boka_auth_user_data') ? JSON.parse(localStorage.getItem('boka_auth_user_data')).email : 'test@example.com' }
});

console.log('Response Status:', res.status);
console.log('Response Data:', res.data);

// Should show:
// Response Status: 200
// Response Data: { found: {...} }
```

**✓ PASS:** Status 200, data received  
**✗ FAIL:** Status 401 or error → See "Troubleshooting" section below

### Step 6: Check Network Tab
1. Open DevTools → Network tab
2. Reload page
3. Sign in again
4. Look for requests:
   - `GET /auth/callback?code=...` → 200 ✓
   - `POST /api/admin/check` → 200 ✓
5. Click on any `/api/` request
6. Check "Request Headers" for:
   - `authorization: Bearer eyJ...` ✓
   - `x-tenant-id: t_123` ✓

**✓ PASS:** Authorization header present on all API calls  
**✗ FAIL:** Missing Authorization header → Components not using authFetch()

---

## Full Test Checklist

### 1. Auth Callback
- [ ] Navigate to /auth/signin
- [ ] Click sign-in button
- [ ] Complete OAuth flow (email/magic link)
- [ ] Redirected to /auth/callback?code=...
- [ ] Status should be 200 (page loads)
- [ ] POST /api/admin/check receives 200 response

### 2. Cookies Verification
- [ ] DevTools → Application → Cookies
- [ ] Should see: `sb-[project-id]-auth-token`
- [ ] Cookie should have: Secure, HttpOnly, SameSite flags
- [ ] Cookie path should be: `/`

### 3. localStorage Verification
- [ ] DevTools → Application → Local Storage
- [ ] Should see: `boka_auth_access_token`
- [ ] Should see: `boka_auth_user_data`
- [ ] Should see: `boka_auth_tenant_id`
- [ ] Should see: `boka_auth_role`

### 4. Dashboard Load
- [ ] Redirect completes and dashboard loads
- [ ] No 401 errors in console
- [ ] Dashboard displays user info correctly
- [ ] Sidebar shows tenant name

### 5. API Calls
- [ ] TenantSettings component loads ✓
- [ ] Tenant data displays without error ✓
- [ ] Settings update without 401 error ✓
- [ ] ReservationLogs component loads ✓
- [ ] LLM Metrics component loads ✓

### 6. Network Tab
- [ ] All `/api/admin/*` requests have Authorization header
- [ ] All responses are 200 (no 401)
- [ ] Cookie sent with each request ✓

---

## Common Issues & Quick Fixes

### Issue: Still Seeing 401 After Fix

**Check 1: Is the fix applied?**
```bash
# Check if browser client has cookie handlers
grep -n "cookies:" src/lib/supabase/client.ts

# Should show: cookies: { get, set, remove }
```

**Check 2: Clear everything and sign in fresh**
```javascript
localStorage.clear();
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
location.reload();
// Then sign in again
```

**Check 3: Verify component is using authFetch**
```bash
# Search for plain fetch() calls to /api/
grep -r "fetch(" src/components/ | grep -i "api/"
# Should return nothing
# If it returns results, those need to be changed to authFetch()
```

### Issue: Cookies Not Being Set

**Possible Causes:**
1. Browser client cookie handlers not configured
2. Cookies blocked in browser settings
3. Private/Incognito mode (cookies won't persist)
4. CORS issue (check DevTools → Console)

**Quick Fix:**
```javascript
// Test if cookies work at all
document.cookie = "test=123; path=/";
console.log(document.cookie); // Should include: test=123
```

### Issue: localStorage Not Being Set

**Possible Causes:**
1. OAuth callback failed (check console for errors)
2. /api/admin/check failed or returned unexpected format
3. storeSignInData() didn't execute

**Quick Check:**
```javascript
// See what /api/admin/check returned
// Look in Network tab for the response
// Should be: { "found": { "admin": true/false, "tenant_id": "...", ... } }
```

### Issue: Authorization Header Missing

**Cause:** Component is using `fetch()` instead of `authFetch()`

**Search for the problem:**
```bash
# Find components using fetch() to /api/
grep -r "fetch(" src/components/ | grep -i "api/"
```

**Fix:** Change to authFetch()
```typescript
// WRONG:
await fetch('/api/admin/x', { method: 'GET' })

// RIGHT:
import { authFetch } from '@/lib/auth/auth-api-client';
await authFetch('/api/admin/x', { method: 'GET' })
```

---

## Detailed Verification Script

Run this in DevTools Console to verify everything:

```javascript
// Complete Auth System Verification
console.log('=== AUTH SYSTEM VERIFICATION ===\n');

// 1. Check localStorage
console.log('1. localStorage Check:');
const token = localStorage.getItem('boka_auth_access_token');
const userData = localStorage.getItem('boka_auth_user_data');
const tenantId = localStorage.getItem('boka_auth_tenant_id');
console.log('  ✓ Token present:', !!token);
console.log('  ✓ Token length:', token?.length);
console.log('  ✓ User data present:', !!userData);
console.log('  ✓ Tenant ID:', tenantId);

// 2. Check cookies
console.log('\n2. Cookie Check:');
const hasSBCookie = document.cookie.includes('sb-');
console.log('  ✓ Supabase cookie present:', hasSBCookie);
console.log('  ✓ Cookies:', document.cookie);

// 3. Test authFetch
console.log('\n3. authFetch() Test:');
try {
  const res = await authFetch('/api/admin/check', {
    method: 'POST',
    body: { email: 'test@example.com' }
  });
  console.log('  ✓ authFetch works');
  console.log('  ✓ Status:', res.status);
  console.log('  ✓ Data:', res.data ? 'Received' : 'None');
} catch (e) {
  console.log('  ✗ authFetch failed:', e.message);
}

// 4. Test manual Authorization header
console.log('\n4. Manual Authorization Test:');
try {
  const res = await fetch('/api/admin/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ email: 'test@example.com' })
  });
  console.log('  ✓ Manual auth works');
  console.log('  ✓ Status:', res.status);
  const data = await res.json();
  console.log('  ✓ Response:', data.found ? 'Found user' : 'No user');
} catch (e) {
  console.log('  ✗ Manual auth failed:', e.message);
}

console.log('\n=== VERIFICATION COMPLETE ===');
```

**Expected Output:**
```
=== AUTH SYSTEM VERIFICATION ===

1. localStorage Check:
  ✓ Token present: true
  ✓ Token length: 987
  ✓ User data present: true
  ✓ Tenant ID: t_abc123

2. Cookie Check:
  ✓ Supabase cookie present: true
  ✓ Cookies: sb-[project-id]-auth-token=eyJ...

3. authFetch() Test:
  ✓ authFetch works
  ✓ Status: 200
  ✓ Data: Received

4. Manual Authorization Test:
  ✓ Manual auth works
  ✓ Status: 200
  ✓ Response: Found user

=== VERIFICATION COMPLETE ===
```

---

## Final Verification

### All Components Working?

```bash
# Test each component that was fixed:

# 1. TenantSettings (GET)
curl -H "Authorization: Bearer $(node -e 'console.log(localStorage.getItem("boka_auth_access_token"))')" \
  http://localhost:3000/api/admin/tenant/123/settings

# Expected: 200 with tenant data

# 2. TenantSettings (PUT)
curl -X PUT \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Name"}' \
  http://localhost:3000/api/admin/tenant/123/settings

# Expected: 200 with updated data

# 3. ReservationLogs
curl -H "Authorization: Bearer {TOKEN}" \
  http://localhost:3000/api/admin/reservation-logs?tenant_id=123

# Expected: 200 with logs array

# 4. LLM Metrics
curl -H "Authorization: Bearer {TOKEN}" \
  http://localhost:3000/api/admin/metrics

# Expected: 200 with metrics
```

---

## Success Criteria

✅ **You can mark the fix as successful when:**

1. **Sign-in completes** → Redirects to dashboard
2. **Cookies set** → `sb-[project-id]-auth-token` present
3. **localStorage set** → All 5 boka_auth_* keys present
4. **No 401 errors** → All API calls return 200
5. **All components load** → Dashboard, settings, logs, metrics all display without errors
6. **Authorization header sent** → Network tab shows `Authorization: Bearer ...` on all API calls
7. **Cookies sent** → Network tab shows `Cookie: sb-...` on all requests

---

## Help & Reference

- **Full troubleshooting:** `AUTH_TROUBLESHOOTING_GUIDE.md`
- **Architecture deep-dive:** `AUTH_SYSTEM_COMPREHENSIVE_GUIDE.md`
- **Why the fix works:** `SUPABASE_BROWSER_CLIENT_FIX.md`
- **Component fixes:** `MISSING_AUTHORIZATION_FIX_REPORT.md`
- **Visual explanation:** `AUTH_VISUAL_FIX_GUIDE.md`

---

Done! The auth system should now work correctly. 🎉
