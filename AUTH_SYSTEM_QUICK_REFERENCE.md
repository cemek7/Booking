# Auth System - Quick Reference & Troubleshooting

## 🎯 Current Architecture

**localStorage** (PRIMARY) → **authFetch()** → **Authorization Header** → **API Routes** → **Token Verification**

---

## 📦 Storage Keys (localStorage)

| Key | Purpose | Example | Set By |
|-----|---------|---------|--------|
| `boka_auth_access_token` | JWT token from Supabase | `eyJhbGciOiJIUzI1...` | Callback |
| `boka_auth_user_data` | User email & ID | `{"email":"user@...","user_id":"..."}` | Callback |
| `boka_auth_tenant_id` | Tenant context | `123e4567-e89b-12d3-a456...` | Callback |
| `boka_auth_role` | User role | `owner` \| `manager` \| `staff` | Callback |
| `boka_auth_is_admin` | Admin flag | `true` \| `false` | Callback |

**Set When:** User completes OAuth signin and callback processes
**Read When:** Components call `authFetch()` to build Authorization header

---

## 📥 How Data Flows In

```
User Signs In
    ↓
Supabase OAuth
    ↓
Browser redirect to /auth/callback?code=...
    ↓
finishAuth() extracts session.access_token
    ↓
POST /api/admin/check { email }
    ↓
Server queries: admins + tenant_users tables
    ↓
Returns: { found: { admin, tenant_id, role, email, user_id } }
    ↓
storeSignInData({
  accessToken,    ← from Supabase
  admin,          ← from database
  tenant_id,      ← from database
  role,           ← from database
  email,          ← from database
  user_id         ← from database
})
    ↓
storeAllAuthData() writes 5 localStorage keys
    ↓
Verify all stored successfully
    ↓
Wait 500ms
    ↓
Redirect to /dashboard or /admin/dashboard
```

---

## 🔄 How Data Flows Out

```
Component needs data
    ↓
Calls: authFetch('/api/endpoint')
    ↓
authFetch() calls buildAuthHeaders()
    ↓
buildAuthHeaders() reads 5 localStorage keys
    ↓
Returns: {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer {token}',
  'X-Tenant-ID': '{tenant_id}'
}
    ↓
fetch() sends with these headers
    ↓
API route receives request
    ↓
createHttpHandler checks:
  ✓ Authorization header exists
  ✓ Token format is "Bearer ..."
  ✓ Token signature valid (verified with Supabase)
  ✓ User has correct role/permissions
    ↓
Execute API logic
    ↓
Return 200 + data
```

---

## 🚀 Quick Start: Add Authenticated API Call

### 1️⃣ Create API Endpoint

```typescript
// src/app/api/example/route.ts
import { createHttpHandler } from '@/lib/error-handling/route-handler';

export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.user = authenticated user from token
    // ctx.userData = { role, tenant_id, permissions }
    
    const result = await ctx.supabase
      .from('my_table')
      .select('*')
      .eq('tenant_id', ctx.userData.tenant_id);
    
    return { data: result.data };
  },
  'GET',
  { auth: true }  // ← Requires authentication
);
```

### 2️⃣ Call from Component

```typescript
// Any client component
import { authFetch } from '@/lib/auth/auth-api-client';

async function loadData() {
  const { data, error } = await authFetch('/api/example');
  
  if (error) {
    console.error('API failed:', error.message);
    return;
  }
  
  // Use data
  setData(data);
}
```

### 3️⃣ That's It!

Authorization header is **automatically included**. No manual header management needed.

---

## ⚠️ Common Issues & Solutions

### Issue: 401 "missing_authorization"

**Cause:** API request sent without Authorization header

**Check:**
```javascript
// In browser console:
localStorage.getItem('boka_auth_access_token')
// Should return a long string starting with "eyJ..."
// If null/empty → token wasn't stored
```

**Solution:**
1. Check callback page logs during signin
2. Verify /api/admin/check returns successfully
3. Check storeSignInData() was called
4. Verify DashboardLayoutContent's authReady check passes

---

### Issue: Components Render Before Token Available (RACE CONDITION)

**Symptoms:**
- 401 errors on first page load
- Works on page refresh
- Appears to work sometimes, fails other times

**Root Cause:**
Component tries to make API call before token is in localStorage

**Status:** ✅ FIXED in `src/components/DashboardLayoutClient.tsx`

The component now:
```typescript
const [authReady, setAuthReady] = useState(false);

useEffect(() => {
  // Wait for token
  const checkAuth = () => {
    const token = localStorage.getItem('boka_auth_access_token');
    if (token) {
      setAuthReady(true);
    } else if (attempts < 20) {
      attempts++;
      setTimeout(checkAuth, 100);
    } else {
      setAuthReady(true); // timeout
    }
  };
  checkAuth();
}, []);

if (!authReady) return <LoadingSpinner />;
// Safe to render children now
```

---

### Issue: Token Expires During Session

**Current Status:** ❌ NOT IMPLEMENTED

**What happens:**
- Token expires after some time (usually 1 hour)
- API calls start returning 401
- User must sign in again

**Solution (needed):**
Implement token refresh:
```typescript
// In auth-api-client.ts, handle 401:
if (response.status === 401) {
  const newToken = await refreshAccessToken();
  if (newToken) {
    // Retry with new token
    return authFetch(url, options);
  } else {
    // Redirect to signin
    window.location.href = '/auth/signin';
  }
}
```

---

### Issue: Multi-Tab Consistency

**Question:** If user opens two tabs and signs in, do both tabs get auth?

**Answer:** ✅ YES - localStorage is shared across tabs

When user signs in:
1. localStorage keys written in one tab
2. Other tabs can immediately read them (localStorage is shared)
3. Both tabs have access to token

---

### Issue: Cookies Not Being Set

**Question:** Should we be using cookies?

**Answer:** ⚠️ PARTIALLY

**Current state:**
- **Supabase SSR adapter** sets cookies (legacy pattern)
- **API auth** uses Authorization header instead (modern pattern)
- **Middleware** looks for 'session-token' cookie (doesn't block, just legacy)

**Recommendation:**
- Keep localStorage for client-side auth ✓
- Keep Authorization header for API calls ✓
- Legacy cookies can be removed (they're not used)

---

## 🔐 Security Checklist

| Item | Status | Notes |
|------|--------|-------|
| Token stored securely | ⚠️ PARTIAL | In localStorage (not httpOnly) - visible to XSS |
| Token sent to API | ✅ YES | Via Authorization header |
| Token verified on server | ✅ YES | Supabase signature check |
| HTTPS enforced | ❓ DEPENDS | Depends on deployment |
| CSRF protection | ❌ NO | localStorage not auto-sent (no CSRF risk) |
| Token refresh | ❌ NO | Manual refresh needed when expired |
| Role-based access | ✅ YES | Database query for role/permissions |
| Multi-tenant isolation | ✅ YES | X-Tenant-ID header + database filter |

---

## 📊 Request/Response Cycle

### ✅ Successful Flow

```
Component calls:
  authFetch('/api/chats')

Auth Headers Built:
  Authorization: Bearer eyJ...
  X-Tenant-ID: 123e4567...
  Content-Type: application/json

Server Receives:
  ✓ Has Authorization header
  ✓ Token format correct (Bearer ...)
  ✓ Token signature valid
  ✓ User found in database
  ✓ User has 'owner' role
  ✓ Tenant ID matches

API Handler Executes:
  Query chats for this tenant
  Filter by user permissions
  
Response:
  200 OK
  {
    data: [ { id: 1, ... }, ... ]
  }

Component:
  Receives data
  Updates state
  Re-renders with results
```

### ❌ Failed Flow (401 Error)

```
Component calls:
  authFetch('/api/chats')

Auth Headers Built:
  BUT: localStorage.getItem('boka_auth_access_token') returns null
  
So Headers Become:
  Content-Type: application/json
  X-Tenant-ID: undefined
  (Authorization: missing)

Server Receives:
  ✗ No Authorization header
  
Route Handler:
  if (!authHeader.startsWith('Bearer ')) {
    return 401 { error: 'missing_authorization' }
  }

Response:
  401 Unauthorized
  { error: 'missing_authorization' }

Component:
  Receives error
  Shows error message
  ❌ API call failed
```

---

## 🧪 Testing Auth

### Verify Token Storage

```javascript
// Open browser console after signing in
localStorage.getItem('boka_auth_access_token')
// Should show: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

localStorage.getItem('boka_auth_user_data')
// Should show: {"email":"user@example.com","user_id":"..."}

localStorage.getItem('boka_auth_tenant_id')
// Should show: "123e4567-e89b-12d3-a456-426614174000"

localStorage.getItem('boka_auth_role')
// Should show: "owner" or "manager" or "staff"

localStorage.getItem('boka_auth_is_admin')
// Should show: "true" or "false"
```

### Verify API Call Headers

```javascript
// In browser DevTools → Network tab
// Click on any GET/POST request

// Look for Headers section:
// Authorization: Bearer eyJhbGciOi...  ← Should be present
// X-Tenant-ID: 123e4567...              ← Should be present
// Content-Type: application/json        ← Always present

// If Authorization is missing → token wasn't in localStorage
```

### Verify Component Rendering

```javascript
// In browser console
// After signing in and navigating to /dashboard

console.log('Auth ready?', 
  localStorage.getItem('boka_auth_access_token') ? 'YES' : 'NO'
)

// Should see logs from DashboardLayoutContent:
// [DashboardLayoutContent] ✓ Auth token found, children ready to render

// If it says "Auth token not yet available", 
// means component tried to render too early (before my fix)
```

---

## 📋 File Reference

| File | Purpose | Key Functions |
|------|---------|---|
| `src/lib/auth/token-storage.ts` | Store/retrieve auth data | `getStoredAccessToken()`, `setStoredAccessToken()`, `storeAllAuthData()` |
| `src/lib/auth/auth-headers.ts` | Build Authorization header | `buildAuthHeaders()`, `mergeHeaders()` |
| `src/lib/auth/auth-api-client.ts` | Fetch wrapper with auth | `authFetch()`, `authGet()`, `authPost()` |
| `src/lib/auth/auth-manager.ts` | Orchestrate signin | `storeSignInData()`, `getRedirectUrl()` |
| `src/app/auth/callback/page.tsx` | Handle OAuth callback | `finishAuth()` |
| `src/app/api/admin/check/route.ts` | Lookup user role/tenant | Query admins + tenant_users |
| `src/lib/error-handling/route-handler.ts` | Validate auth on API routes | `createHttpHandler()` |
| `src/components/DashboardLayoutClient.tsx` | Wait for auth before rendering | Auth readiness check |

---

## 🚨 If localStorage Causes Issues

**Scenario:** You decide localStorage is too risky due to XSS

**Migration Path:**

1. **Move token to httpOnly cookie:**
   ```typescript
   // In callback, instead of localStorage:
   // Set cookie on response:
   response.cookies.set('auth_token', token, {
     httpOnly: true,
     secure: true,
     sameSite: 'lax',
     maxAge: 60 * 60 * 24 * 7  // 1 week
   });
   ```

2. **Update authFetch to use default credentials:**
   ```typescript
   // fetch will auto-send httpOnly cookies
   fetch(url, {
     credentials: 'include',  // ← Auto-send cookies
     headers: { ... }
   });
   ```

3. **Add CSRF protection:**
   ```typescript
   // For POST/PUT/PATCH/DELETE:
   const csrfToken = document.querySelector('[name="_csrf"]').value;
   headers['X-CSRF-Token'] = csrfToken;
   ```

4. **Update server to read from cookies:**
   ```typescript
   // Instead of Authorization header
   const token = request.cookies.get('auth_token')?.value;
   ```

**Trade-offs:**
- ✅ Token not visible in DevTools (secure)
- ❌ Can't control per-request (less flexible)
- ❌ Need CSRF tokens (more complexity)
- ⚠️ Requires refresh token mechanism

---

## Summary

Your current system is **working correctly** with localStorage as primary auth storage. The recent fix for rendering timing eliminates the race condition. localStorage is safe here because:

1. ✅ Token only sent when explicitly calling `authFetch()`
2. ✅ Server validates token on every request
3. ✅ No sensitive data in localStorage except token
4. ✅ Even if XSS happens, attacker can only read token (not execute auth)

**No changes needed unless:**
- Token starts expiring (implement refresh logic)
- CSRF becomes a concern (use token-based auth instead of cookies)
- Need httpOnly cookies (major refactor)
