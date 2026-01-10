# Quick Test Runbook - Run These Steps Now

## What You Need to Do

1. Open browser DevTools (F12)
2. Go through the test steps below
3. Report what logs you see

---

## Test Steps

### STEP 1: Clear All Data & Restart
```javascript
// Paste into DevTools Console:
localStorage.clear();
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
location.reload();
```

**Expected:** Page refreshes, logs appear in console

---

### STEP 2: Sign In Fresh
1. Navigate to `/auth/signin`
2. Click **Sign In** button
3. Complete OAuth in the popup
4. Watch the **Console tab** carefully

**Expected logs (in order):**
```
[auth/callback] About to fetch session...
[auth/callback] Extracted session data
[auth/callback] Calling POST /api/admin/check
[auth/callback] Admin check returned 200
[auth/callback] Storing auth data: { hasAccessToken: true, ... }
[auth/callback] IMMEDIATE VERIFICATION after storeSignInData: { tokenStored: true, ... }
[auth/callback] Redirecting to: /dashboard
```

**What to report if you see these logs:**
- Did all logs appear?
- What was in the `IMMEDIATE VERIFICATION` log? (especially `tokenStored:` value)
- Did it redirect to `/dashboard`?

---

### STEP 3: Check Storage & Cookies
Still in DevTools, go to **Application** tab:

**Check Local Storage:**
- Go to: Application → Local Storage → (your domain)
- Look for these keys:
  - `boka_auth_access_token` - Should be present
  - `boka_auth_tenant_id` - Should be present
  - `boka_auth_user_data` - Should be present

**Check Cookies:**
- Go to: Application → Cookies → (your domain)
- Look for: `sb-` prefix cookies (Supabase session)
- Should see at least one Supabase auth cookie

**What to report:**
- Are the localStorage keys present? (yes/no for each)
- Are the Supabase cookies present? (yes/no)

---

### STEP 4: Check Network Requests
Go to **Network** tab, then:

1. Try to navigate to `/dashboard` (if not already there)
2. Look for requests in the Network tab
3. Find a request to `/api/` (like `/api/chats` or `/api/tenants`)
4. Click on it
5. Go to **Headers** tab
6. Scroll down to **Request Headers** section
7. Look for: `Authorization: Bearer ...`

**What to report:**
- Does the `Authorization` header exist? (yes/no)
- If yes, does it start with `Bearer`?
- If no, what other headers do you see?

---

### STEP 5: Check Console Errors
Go back to **Console** tab and look for any **RED ERROR messages**:

**What to report:**
- Are there any red errors?
- If yes, copy the full error message

---

## Quick Diagnosis Reference

Based on your findings, here's what each result means:

### Case 1: All Logs Present + localStorage Keys Present + Authorization Header Present
**Status:** ✅ Client side is working  
**Problem:** Likely server-side validation issue  
**Next:** Check server logs for why it's rejecting the token

### Case 2: Logs Missing or `tokenStored: false` + localStorage Keys Missing
**Status:** ❌ Token NOT being stored  
**Problem:** Issue in /api/admin/check or storeSignInData()  
**Next:** Check what `/api/admin/check` returns

### Case 3: localStorage Keys Present + Authorization Header Missing
**Status:** ❌ Token exists but authFetch() can't read it  
**Problem:** Issue in buildAuthHeaders() or reading from localStorage  
**Next:** Check if token format is valid

### Case 4: No Supabase Cookies Present
**Status:** ❌ Session not persisted  
**Problem:** Browser Supabase client not configured correctly  
**Next:** Verify cookie handlers in src/lib/supabase/client.ts

---

## What to Paste Into Console

If you want to run a complete diagnostic in one go:

```javascript
console.log('=== QUICK AUTH DIAGNOSTIC ===');

// Check localStorage
const token = localStorage.getItem('boka_auth_access_token');
const tenantId = localStorage.getItem('boka_auth_tenant_id');
const userData = localStorage.getItem('boka_auth_user_data');

console.log('localStorage status:');
console.log('  Token present:', !!token);
console.log('  Token length:', token?.length || 0);
console.log('  Tenant ID:', tenantId);
console.log('  User data:', userData ? 'present' : 'missing');

// Check cookies
const cookieStr = document.cookie;
const sbCookies = cookieStr.split(';').filter(c => c.includes('sb-'));
console.log('\nCookies status:');
console.log('  SB auth cookies:', sbCookies.length > 0 ? 'FOUND' : 'NOT FOUND');
console.log('  Total cookie count:', cookieStr.split(';').length);

// Check if we can read the header-building function
console.log('\nTesting header building...');
try {
  const token2 = localStorage.getItem('boka_auth_access_token');
  console.log('  Can read token from localStorage:', !!token2);
} catch (e) {
  console.log('  ERROR reading localStorage:', e.message);
}

console.log('\n=== END DIAGNOSTIC ===');
```

---

## Report Template

Copy and fill this out:

```
SIGN-IN LOGS:
- Did [auth/callback] logs appear? YES / NO
- What was tokenStored value? _______
- Did redirect happen? YES / NO

STORAGE CHECK:
- boka_auth_access_token present? YES / NO
- boka_auth_tenant_id present? YES / NO
- boka_auth_user_data present? YES / NO
- SB cookies present? YES / NO

NETWORK CHECK:
- Authorization header present? YES / NO
- Header format correct (Bearer...)? YES / NO

CONSOLE ERRORS:
- Any red errors? YES / NO
- If yes, error message: _______
```

---

## NOW: Steps to Run

1. ✅ Open DevTools (F12)
2. ✅ Keep Console tab open
3. ✅ Copy Step 1 code into console and run
4. ✅ Go to /auth/signin
5. ✅ Sign in and watch the logs
6. ✅ Complete the diagnostic checks in Steps 3-5
7. ✅ Report your findings using the template above

**Go ahead and run these now!** Then report what you see.
