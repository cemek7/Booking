# Quick Diagnostic Commands for Browser Console

After signing in, run these commands in the browser console to verify everything is working:

## Check 1: Verify All Auth Keys Are Present

```javascript
const requiredKeys = [
  'boka_auth_access_token',
  'boka_auth_user_data',
  'boka_auth_tenant_id',
  'boka_auth_role',
  'boka_auth_is_admin'
];

console.log('=== Auth Keys Status ===');
requiredKeys.forEach(key => {
  const value = localStorage.getItem(key);
  const status = value ? '✓' : '✗';
  console.log(`${status} ${key}: ${value ? 'PRESENT (' + (typeof value === 'string' ? value.substring(0, 30) : value) + ')' : 'MISSING'}`);
});
```

**Expected output:** All 5 keys should have ✓

---

## Check 2: Inspect Token Contents

```javascript
const token = localStorage.getItem('boka_auth_access_token');
if (token) {
  console.log('Token Length:', token.length);
  console.log('Token Preview:', token.substring(0, 100) + '...');
  console.log('Is Bearer Format:', token.startsWith('eyJ'));
} else {
  console.log('✗ No token found!');
}
```

**Expected output:** Token should start with `eyJ` (JWT format)

---

## Check 3: Inspect User Data

```javascript
const userData = localStorage.getItem('boka_auth_user_data');
if (userData) {
  try {
    const parsed = JSON.parse(userData);
    console.log('User Email:', parsed.email);
    console.log('User ID:', parsed.user_id);
    console.log('Tenant ID:', parsed.tenant_id);
    console.log('Role:', parsed.role);
    console.log('Is Admin:', parsed.admin);
  } catch (e) {
    console.error('Failed to parse user data:', e);
  }
} else {
  console.log('✗ No user data found!');
}
```

**Expected output:** User details should show correctly

---

## Check 4: Monitor Next API Calls

```javascript
// Add this to intercept all fetch calls
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const [url, options] = args;
  console.log(`📤 FETCH: ${options?.method || 'GET'} ${url}`);
  console.log('   Headers:', options?.headers);
  
  return originalFetch.apply(this, args).then(response => {
    console.log(`📥 RESPONSE: ${response.status} ${response.statusText}`);
    return response;
  }).catch(err => {
    console.error('❌ FETCH ERROR:', err);
    throw err;
  });
};
```

Run this BEFORE triggering API calls to see all requests in console

---

## Check 5: Verify TenantProvider Context

```javascript
// In React DevTools or by inspecting:
// Look for console logs like:
// [TenantProvider] ✓ Found tenant in NEW auth storage
// OR
// [TenantProvider] ⚠ Found tenant in OLD storage (backward compat)
```

**Expected:** Should find tenant in either NEW or OLD storage

---

## Check 6: Test API Call Manually

```javascript
// Test if Authorization header is being sent correctly
const token = localStorage.getItem('boka_auth_access_token');
const tenantId = localStorage.getItem('boka_auth_tenant_id');

const response = await fetch('/api/services', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': tenantId,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log('Status:', response.status);
console.log('Data:', data);
```

**Expected:** Should return 200 with data, NOT 401

---

## Check 7: View All Console Logs Related to Auth

```javascript
// Filter console for auth-related messages
console.log('=== Recent Auth Logs ===');
// Look for these patterns in browser console:
// [AuthManager]
// [TenantProvider]
// [TokenStorage]
// [AuthHeaders]
// [AuthAPIClient]
// [auth/callback]
```

---

## If You See 401 Errors

Run this sequence:

1. Check auth keys are present (Check 1)
2. Check token exists (Check 2)
3. Check user data (Check 3)
4. Check TenantProvider logs (Check 5)
5. Try manual API call (Check 6)
6. Share the error message and console logs

---

## Expected Console Output After Signin

You should see something like this:

```
[auth/callback] ✓ Token storage verification SUCCESS
[auth/callback] Token length: 456
[AuthManager] Storing sign-in data for: user@example.com
[AuthManager] User type: tenant-owner
[AuthManager] ✓ Sign-in data stored successfully
[TenantProvider] Loading tenant information...
[TenantProvider] ✓ Found tenant in NEW auth storage (attempt 1)
[TenantProvider] Tenant ID: 550e8400-e29b-41d4-a716-446655440000
[TenantProvider] Role: owner
[AuthHeaders] ✓ Authorization header included (token length: 456)
[AuthAPIClient] GET /api/services
[AuthAPIClient] GET /api/services ✓ 200
```

---

## Troubleshooting Matrix

| Symptom | Check | Expected | If Failed |
|---------|-------|----------|-----------|
| Still getting 401 | Check 1 | All 5 keys present | Token not stored after signin |
| Token is empty | Check 2 | Token starts with `eyJ` | Signin not completed properly |
| Tenant ID is null | Check 3 & 5 | Tenant ID shows | TenantProvider didn't find tenant |
| API shows no headers | Check 4 | Authorization in headers | buildAuthHeaders failed |
| Manual fetch fails | Check 6 | Status 200 | Server rejecting valid tokens |

---

## Next Steps

1. **Sign in fresh** - Clear localStorage first if needed
2. **Run Check 1** - Verify all keys are stored
3. **Share results** if anything fails
4. **Monitor console** - Watch for the expected log patterns

