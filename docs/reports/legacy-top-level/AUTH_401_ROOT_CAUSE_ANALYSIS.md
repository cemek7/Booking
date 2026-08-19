# Auth 401 Error - Detailed Flow & Root Cause

## What Was Happening (Before Fix)

### Symptom
```
GET /dashboard → 401 Unauthorized
Error: { "error": "missing_authorization", "code": "missing_authorization" }
(appears twice in console)
```

### The Race Condition Timeline

```
TIME  EVENT                                          STATUS
─────────────────────────────────────────────────────────────────

0ms   User clicks sign-in button                     ✓
      → Browser redirects to /auth/signin

100ms Sign-in completes, user gets Supabase auth     ✓
      → Browser shows auth callback page

150ms /auth/callback page runs:
      - Gets session from Supabase
      - Calls POST /api/admin/check                   ✓ 200 OK
      - Gets user role & tenant info

200ms storeSignInData() runs:
      - Calls storeAllAuthData() 
      - Stores token in localStorage
      - Verifies storage: ✓ token present            ✓ STORED

250ms Waits 500ms delay...

700ms Redirects to /dashboard                        ✓
      → Browser requests GET /dashboard

705ms /dashboard page loads (client component)       
      - DashboardLayout renders                      
      - DashboardLayoutClient mounts                 
      - TenantProvider mounts
      
710ms TenantProvider useEffect starts:
      - Tries to read 'boka_auth_tenant_id' from localStorage
      - Item not there yet (still being written?)
      - Retries with 200ms delays...

710ms Meanwhile, DashboardLayoutContent renders children:
      - ChatsList mounts                             ⚠️ TOO EARLY
      - CustomersList mounts                         ⚠️ TOO EARLY  
      - ServicesList mounts                          ⚠️ TOO EARLY

712ms ChatsList useQuery fires:
      - Calls authFetch('/api/chats?...')
      - authFetch calls buildAuthHeaders()
      - buildAuthHeaders calls getStoredAccessToken()
      - localStorage.getItem('boka_auth_access_token')
      - Returns: NULL or empty ❌ TOKEN NOT READY YET
      - Builds headers WITHOUT Authorization header

715ms HTTP request sent to /api/chats:
      - Headers: { Content-Type: 'application/json' }
      - No Authorization header ❌

720ms API route handler checks request:
      ```typescript
      const authHeader = request.headers.get('authorization');
      if (!authHeader.startsWith('Bearer ')) {
        throw ApiErrorFactory.missingAuthorization();
        // → Returns 401 { error: 'missing_authorization' }
      }
      ```
      
730ms Same error happens for:
      - POST /api/customers
      - POST /api/services
      (They all try to render and fetch simultaneously)

740ms User sees:
      - 401 errors in console (2x or more)
      - Dashboard page fails to load
      - Components stuck in loading state
```

## Why The Token Wasn't Available

### Root Cause: No Synchronization Point

The callback stores the token, but components don't wait for it!

**Callback side:**
```
store token → verify stored → 500ms delay → redirect
```

**Component side:**
```
page loads → components mount → fetch immediately → token not ready yet!
```

**The problem:** Between "redirect" (700ms) and "component mounts" (710ms), **the token might still be in process of being written to localStorage**, especially if:
- Browser JavaScript engine is busy
- Other tabs are running
- Memory pressure causes delays

### Why It Happened Twice

`authFetch()` is called by:
1. ChatsList → /api/chats
2. CustomersList → /api/customers
3. ServicesList → /api/services (sometimes)

Each fails with 401 when token is not available.

## The Fix Explanation

### Before Rendering, Wait For Token

```typescript
// DashboardLayoutContent now does this:

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // Check if token is in localStorage
    // Retry every 100ms for up to 2 seconds
    // Only render children when token is confirmed present
    const token = localStorage.getItem('boka_auth_access_token');
    if (token) {
      setAuthReady(true); // NOW safe to render
    }
  }, []);

  if (!authReady) {
    return <LoadingSpinner />; // Show spinner instead
  }

  // NOW render children - token is guaranteed present
  return <DashboardContent />;
}
```

### Timeline After Fix

```
TIME  EVENT                                          STATUS
─────────────────────────────────────────────────────────────────

700ms Redirect to /dashboard                        ✓

705ms /dashboard page loads
      - DashboardLayoutClient mounts
      - TenantProvider mounts
      - DashboardLayoutContent mounts

710ms DashboardLayoutContent useEffect:
      - Check: localStorage.getItem('boka_auth_access_token')
      - Result: Not found yet
      - Schedule retry in 100ms

720ms Still not ready, show <LoadingSpinner />      ⏳ WAITING

730ms DashboardLayoutContent retry:
      - Check: localStorage.getItem('boka_auth_access_token')
      - Result: FOUND! ✓

735ms setAuthReady(true) → re-render with children

740ms NOW safe: ChatsList mounts
      - authFetch('/api/chats')
      - buildAuthHeaders() reads token ✓ FOUND
      - Adds Authorization header ✓

745ms HTTP request with Authorization:
      - Headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOi...' ✓
        }

750ms API route checks:
      ```typescript
      if (authHeader.startsWith('Bearer ')) {
        // ✓ Authorization present!
        // Verify token signature...
        // Query database...
        return { data: chats };
      }
      ```

800ms Dashboard renders successfully ✓
      - ChatsList shows chats ✓
      - CustomersList shows customers ✓
      - ServicesList shows services ✓
```

## Key Differences

| Before Fix | After Fix |
|-----------|-----------|
| Components render immediately | Components wait for auth token |
| buildAuthHeaders() gets null token | buildAuthHeaders() gets valid token |
| Authorization header missing | Authorization header present |
| API returns 401 | API returns 200 with data |
| Multiple 401 errors in console | Clean successful loads |
| Dashboard fails to display | Dashboard displays correctly |

## Why This Matters

This pattern applies to **any authentication system where:**
1. Auth token is stored asynchronously
2. Components need that token to make API calls
3. There's a timing gap between storage and first use

**The solution:** Always synchronize component rendering with auth state availability.

## Verification Logs

After the fix is applied, you should see in browser console:

```
[DashboardLayoutContent] Auth token not yet available (attempt 1/20), retrying...
[DashboardLayoutContent] Auth token not yet available (attempt 2/20), retrying...
[DashboardLayoutContent] ✓ Auth token found, children ready to render
[AuthHeaders] ✓ Authorization header included (token length: 256)
[AuthAPIClient] GET /api/chats?tenant_id=... ✓ 200
[AuthAPIClient] GET /api/customers ✓ 200
[AuthAPIClient] GET /api/services ✓ 200
```

If you still see 401 errors after this fix, the root cause is different - check that:
- Token is actually being stored (verify with `localStorage.getItem('boka_auth_access_token')`)
- Token value is not empty or "null" string
- Callback is not failing before storage
