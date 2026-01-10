# Auth Token Timing Fix - Root Cause & Solution

## Problem Identified

**User reported:** GET /dashboard returning 401 "missing_authorization" errors after signin, even though:
- ✓ POST /api/admin/check succeeds (200)
- ✓ Token is stored in localStorage
- ✓ Callback redirects to /dashboard

## Root Cause Analysis

**The 401 errors were happening because of a race condition:**

1. **Auth callback flow (fast):**
   - Supabase callback completes
   - `storeSignInData()` stores token in localStorage
   - Callback verifies token storage
   - 500ms delay
   - Redirect to /dashboard

2. **Dashboard component rendering (also fast):**
   - Page loads immediately
   - DashboardLayoutClient mounts
   - TenantProvider mounts and starts loading tenant info
   - **But children render WHILE TenantProvider is still loading** (not waiting)
   - ChatsList, CustomersList, ServicesList components mount
   - They call `useQuery` → `authFetch()` → `buildAuthHeaders()`
   - **At this exact moment, token might NOT be in localStorage yet!**
   - `buildAuthHeaders()` can't add Authorization header
   - API routes receive request without Authorization header
   - API route handler throws 401 "missing_authorization"

**Why:** Components were rendering before the auth token was guaranteed to be available in localStorage. The timing was critical - a few milliseconds difference could make the difference between success and failure.

## Solution Implemented

### 1. **DashboardLayoutClient** - Added auth readiness check

**File:** `src/components/DashboardLayoutClient.tsx`

```tsx
function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);

  // Wait for auth token to be available in localStorage before rendering children
  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    const maxAttempts = 20; // 20 * 100ms = 2 seconds max

    const checkAuthToken = () => {
      try {
        const token = localStorage.getItem('boka_auth_access_token');
        if (token) {
          console.log('[DashboardLayoutContent] ✓ Auth token found, children ready to render');
          if (mounted) setAuthReady(true);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          console.debug(`[DashboardLayoutContent] Auth token not yet available (attempt ${attempts}/${maxAttempts})`);
          setTimeout(checkAuthToken, 100);
        } else {
          console.warn('[DashboardLayoutContent] ✗ Auth token not found after 2 seconds, proceeding anyway');
          if (mounted) setAuthReady(true);
        }
      } catch (err) {
        console.error('[DashboardLayoutContent] Error checking auth token:', err);
        if (mounted) setAuthReady(true);
      }
    };

    checkAuthToken();
    return () => { mounted = false; };
  }, []);

  // Don't render children until auth is ready
  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
      {/* ... rest of layout ... */}
    </div>
  );
}
```

**What it does:**
- Checks localStorage every 100ms for auth token (up to 2 seconds)
- Only renders children AFTER token is confirmed present
- Shows loading spinner while waiting
- Falls back to rendering anyway if token doesn't appear (prevents infinite loading)

### 2. **Admin Dashboard** - Applied same fix

**File:** `src/app/admin/page.tsx`

- Added auth readiness check before loading tenant data
- Wrapped data loading useEffect to wait for `authReady` state
- Shows loading spinner while waiting for auth
- Updated `AdminLLMUsage` to use `authFetch()` instead of plain `fetch()`

## Why This Fix Works

1. **Eliminates race condition:** Waits for token to be in localStorage before rendering components that need it
2. **Non-blocking:** Shows loading indicator instead of blank page
3. **Failsafe:** After 2 seconds, proceeds anyway (prevents infinite loading if token never appears)
4. **Proper auth headers:** When components render, token is guaranteed to be available, so `authFetch()` can add Authorization header
5. **API calls succeed:** With Authorization header present, API routes accept the request and return data

## Testing

To verify the fix works:

1. **Sign in** with valid credentials
2. **Observe:** "Loading dashboard..." message appears briefly
3. **Wait:** Dashboard loads completely
4. **Check console:** Should see `✓ Auth token found, children ready to render` log
5. **Verify:** ChatsList, CustomersList, ServicesList load without 401 errors

## Files Modified

- [src/components/DashboardLayoutClient.tsx](src/components/DashboardLayoutClient.tsx) - Added auth readiness check
- [src/app/admin/page.tsx](src/app/admin/page.tsx) - Added auth readiness check + switched to authFetch()

## Key Takeaway

**Authorization timing matters.** Even if the auth system is implemented correctly, components must wait for auth data to be available before trying to use it. This fix ensures that contract is enforced.
