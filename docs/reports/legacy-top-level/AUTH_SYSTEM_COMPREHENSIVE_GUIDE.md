# Authentication System Architecture - Comprehensive Analysis

## Current System Overview

Your system uses a **hybrid localStorage + cookies approach** with Supabase as the auth provider.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION SYSTEM                         │
└─────────────────────────────────────────────────────────────────┘

                          SUPABASE
                    (Auth Provider)
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
        
        ╔════════════════════════════════════════════════════════╗
        ║                  CLIENT SIDE (Browser)                 ║
        ║                                                        ║
        ║  localStorage (PRIMARY)                              ║
        ║  ├─ boka_auth_access_token      (JWT from Supabase) ║
        ║  ├─ boka_auth_user_data        (User metadata)      ║
        ║  ├─ boka_auth_tenant_id        (Tenant context)     ║
        ║  ├─ boka_auth_role             (User role)          ║
        ║  └─ boka_auth_is_admin         (Admin flag)         ║
        ║                                                        ║
        ║  Used by:                                             ║
        ║  • authFetch() → buildAuthHeaders()                  ║
        ║  • Components (TenantProvider, ChatsList, etc.)      ║
        ║  • API client calls (GET, POST, etc.)                ║
        ║                                                        ║
        ╚════════════════════════════════════════════════════════╝
                          │
                          │ (HTTP Requests)
                          │ Authorization: Bearer {token}
                          │ X-Tenant-ID: {tenant_id}
                          │
                          ▼
        
        ╔════════════════════════════════════════════════════════╗
        ║               SERVER SIDE (Next.js)                    ║
        ║                                                        ║
        ║  Route Handler (/api/...)                            ║
        ║  ├─ Check: Authorization header                       ║
        ║  ├─ Extract: Bearer token                             ║
        ║  ├─ Verify: Token signature (Supabase)               ║
        ║  └─ Query: Database for role/permissions             ║
        ║                                                        ║
        ║  Cookies (LEGACY/FALLBACK)                           ║
        ║  ├─ session-token (checked by hipaaMiddleware)       ║
        ║  └─ Used by: Supabase SSR adapter                    ║
        ║                                                        ║
        ║  Middleware (proxy.ts)                               ║
        ║  ├─ Applies hipaaMiddleware for non-API routes       ║
        ║  └─ Looks for 'session-token' cookie (OLD METHOD)    ║
        ║                                                        ║
        ╚════════════════════════════════════════════════════════╝
                          │
                          │ (Response)
                          │ Status: 200/401
                          │ Data or Error
                          │
                          ▼
        
        ╔════════════════════════════════════════════════════════╗
        ║                   BROWSER (again)                       ║
        ║  Display results or show error message                ║
        ╚════════════════════════════════════════════════════════╝
```

---

## Component Breakdown

### 1. CLIENT-SIDE: localStorage (PRIMARY AUTH)

**File:** `src/lib/auth/token-storage.ts`

```typescript
STORAGE_KEYS = {
  ACCESS_TOKEN: 'boka_auth_access_token',      // ← JWT from Supabase
  USER_DATA: 'boka_auth_user_data',            // ← User metadata
  TENANT_ID: 'boka_auth_tenant_id',            // ← Which tenant this user belongs to
  ROLE: 'boka_auth_role',                      // ← owner|manager|staff
  IS_ADMIN: 'boka_auth_is_admin',              // ← true|false
}
```

**When stored:**
1. User completes OAuth signin via Supabase
2. Browser redirects to `/auth/callback?code=...&state=...`
3. Callback page (`src/app/auth/callback/page.tsx`):
   - Gets session from Supabase
   - Calls `POST /api/admin/check` with email
   - Gets user role and tenant info
   - Calls `storeSignInData()` from auth-manager
   - `storeSignInData()` calls `storeAllAuthData()` from token-storage
   - All 5 keys are written to localStorage
   - Verifies they were stored
   - Waits 500ms
   - Redirects to /dashboard

**How it's used:**
```typescript
// In any client component:
import { authFetch } from '@/lib/auth/auth-api-client';

// authFetch automatically:
// 1. Calls buildAuthHeaders()
// 2. buildAuthHeaders() calls getStoredAccessToken()
// 3. getStoredAccessToken() reads from localStorage
// 4. Adds Authorization: Bearer {token} header
// 5. Sends request

const response = await authFetch('/api/chats');
```

**Key functions:**
- `getStoredAccessToken()` - Read token from localStorage
- `setStoredAccessToken()` - Write token to localStorage
- `getStoredUserData()` - Read user info
- `setStoredUserData()` - Write user info
- Similar for: TenantId, Role, IsAdmin

---

### 2. CLIENT-SIDE: Auth API Client

**File:** `src/lib/auth/auth-api-client.ts`

```typescript
export async function authFetch<T>(
  url: string,
  options: AuthFetchOptions = {}
): Promise<ApiResponse<T>> {
  // 1. Build headers with auth token
  const authHeaders = buildAuthHeaders();
  
  // 2. Merge with custom headers
  const headers = {
    ...authHeaders,           // ← Token added here!
    ...options.headers,
  };
  
  // 3. Send request
  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  
  // 4. Handle response
  if (!response.ok) {
    if (response.status === 401) {
      console.warn('Received 401 - Authorization failed');
      // Could auto-logout here
    }
    return { error: ..., status: response.status };
  }
  
  return { data: await response.json(), status: response.status };
}
```

**Helper functions:**
- `authFetch()` - Generic fetch with auth
- `authGet()` - GET request
- `authPost()` - POST with body
- `authPut()` - PUT with body
- `authPatch()` - PATCH with body
- `authDelete()` - DELETE request

**Used by:** ChatsList, CustomersList, ServicesList, OwnerLLMMetrics, Phase5Dashboard, SkillManager, etc.

---

### 3. CLIENT-SIDE: Auth Headers Builder

**File:** `src/lib/auth/auth-headers.ts`

```typescript
export function buildAuthHeaders(): FetchHeaders {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Read from localStorage
  const token = getStoredAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;  // ← Token added here
    console.debug('[AuthHeaders] ✓ Authorization header included');
  } else {
    console.warn('[AuthHeaders] ✗ No access token found in localStorage');
  }

  // Also add tenant context
  const tenantId = getStoredTenantId();
  if (tenantId) {
    headers['X-Tenant-ID'] = tenantId;
  }

  return headers;
}
```

**Key points:**
- Reads token from localStorage every time
- Token must exist or header won't be added
- Also adds X-Tenant-ID for multi-tenant context
- Returns undefined values are allowed (merged out later)

---

### 4. CLIENT-SIDE: Auth Manager (Orchestrator)

**File:** `src/lib/auth/auth-manager.ts`

```typescript
export function storeSignInData(params: {
  accessToken: string;
  admin?: boolean;
  tenant_id?: string;
  role?: 'owner' | 'manager' | 'staff';
  email: string;
  user_id: string;
}): void {
  console.log('[AuthManager] Storing sign-in data for:', params.email);
  
  const userData: StoredUserData = {
    email: params.email,
    user_id: params.user_id,
    tenant_id: params.tenant_id,
    role: params.role,
    admin: params.admin,
  };

  // Call storeAllAuthData which writes all 5 keys to localStorage
  storeAllAuthData({
    token: params.accessToken,
    userData,
    tenantId: params.tenant_id,
    role: params.role,
    isAdmin: params.admin || false,
  });

  console.log('[AuthManager] ✓ Sign-in data stored successfully');
}
```

**Responsibilities:**
- Receives auth data from callback
- Calls storeAllAuthData() to persist
- Logs for debugging

---

### 5. SERVER-SIDE: Route Handler Auth Check

**File:** `src/lib/error-handling/route-handler.ts` (lines 82-90)

```typescript
// Handle authentication
if (options.auth !== false) {
  const authHeader = request.headers.get('authorization') || '';
  console.log('[route-handler] Auth check:', authHeader ? 'present' : 'MISSING');
  
  if (!authHeader.startsWith('Bearer ')) {
    const error = ApiErrorFactory.missingAuthorization();
    return error.toResponse();  // ← 401 Response
  }

  const token = authHeader.slice(7);  // Remove "Bearer "
  const supabase = getSupabaseRouteHandlerClient();

  // Verify token with Supabase
  const { data: { user: authUser }, error: authError } = 
    await supabase.auth.getUser(token);

  if (authError || !authUser) {
    const error = ApiErrorFactory.invalidToken();
    return error.toResponse();  // ← 401 Response
  }

  // Get user role from database
  const { data: userData } = await supabase
    .from('tenant_users')
    .select('role, permissions, tenant_id')
    .eq('user_id', authUser.id)
    .maybeSingle();

  // Store in request context for handler
  ctx.user = authUser;
  ctx.userData = userData;
}
```

**Flow:**
1. Check Authorization header exists
2. Extract token from "Bearer {token}"
3. Verify token with Supabase (signature check)
4. Query database for user role/permissions
5. Allow request to proceed

---

### 6. SERVER-SIDE: Supabase SSR (Cookies)

**File:** `src/lib/supabase/server.ts`

```typescript
export function getSupabaseServerComponentClient() {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get: async (name: string) => {
        const cookieStore = await cookies();
        return cookieStore.get(name)?.value;
      },
      set: async (name: string, value: string, options: CookieOptions) => {
        const cookieStore = await cookies();
        cookieStore.set({ name, value, ...options });
      },
      remove: async (name: string, options: CookieOptions) => {
        const cookieStore = await cookies();
        cookieStore.set({ name, value: '', ...options });
      },
    },
  });
}
```

**Purpose:**
- Supabase SSR library expects to manage cookies
- Cookies used for: session management, refresh tokens, etc.
- But in your system, this is mostly UNUSED for API auth
- Your API auth uses Authorization header instead

---

### 7. LEGACY: Middleware Cookie Check

**File:** `src/middleware/hipaaMiddleware.ts` (lines 126-128)

```typescript
private async extractContext(request: NextRequest): Promise<PHIAccessContext | null> {
  try {
    // Get user session from COOKIE (OLD AUTH METHOD)
    const sessionToken = request.cookies.get('session-token')?.value;
    if (!sessionToken) {
      return null;  // No session, continue without blocking
    }

    // Verify with Supabase
    const { data: { user }, error } = await this.supabase.auth.getUser(sessionToken);
    // ...
  }
}
```

**Status:** This is LEGACY code
- Looks for `session-token` cookie (from old auth system)
- Not used for new localStorage-based auth
- Middleware returns `null` if token not found (doesn't block)
- Safe but redundant

---

## Data Flow: Sign-In to API Call

### Complete Journey

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: User Initiates Sign-In                                  │
└─────────────────────────────────────────────────────────────────┘

1. User clicks "Sign In" button
2. AuthMagicLinkForm component sends email to Supabase
3. User receives magic link in email
4. User clicks link → browser redirects to /auth/callback?code=...

┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Auth Callback Processing                                │
│ File: src/app/auth/callback/page.tsx                            │
└─────────────────────────────────────────────────────────────────┘

Timeline:
  0ms    → finishAuth() starts
  10ms   → auth.getSessionFromUrl({ storeSession: true })
           (Supabase internally tries to store in cookies)
  20ms   → session = sessionData (contains access_token)
  30ms   → POST /api/admin/check with email
  100ms  → /api/admin/check returns { found: { admin, tenant_id, role, email, user_id } }
  110ms  → storeSignInData() called with all data
  120ms  → storeAllAuthData() writes 5 localStorage keys:
           - boka_auth_access_token: "eyJhbGciOi..." (256+ chars)
           - boka_auth_user_data: {"email": "user@...", ...}
           - boka_auth_tenant_id: "123e4567..."
           - boka_auth_role: "owner"
           - boka_auth_is_admin: "false"
  130ms  → Verify: localStorage.getItem('boka_auth_access_token') → SUCCESS ✓
  140ms  → console.log('[auth/callback] ✓ Token storage verification SUCCESS')
  600ms  → 500ms delay completes
  610ms  → router.push('/dashboard')

┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Dashboard Page Loads                                     │
│ File: src/app/dashboard/page.tsx                                │
└─────────────────────────────────────────────────────────────────┘

710ms  → Page loads (client component)
715ms  → DashboardLayout renders
720ms  → DashboardLayoutClient mounts
725ms  → TenantProvider mounts
726ms  → DashboardLayoutContent mounts
         │
         ├─ useEffect: checkAuthToken()
         │  └─ localStorage.getItem('boka_auth_access_token') → ✓ FOUND!
         │  └─ setAuthReady(true)
         │
730ms  → authReady = true
735ms  → Render children:
         ├─ ChatsList mounts
         │  └─ useQuery with authFetch()
         │
         ├─ CustomersList mounts
         │  └─ useQuery with authFetch()
         │
         └─ ServicesList mounts
            └─ useQuery with authFetch()

┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: API Fetch with Auth                                      │
│ File: src/lib/auth/auth-api-client.ts                           │
└─────────────────────────────────────────────────────────────────┘

740ms  → ChatsList calls authFetch('/api/chats?tenant_id=123')
         │
         ├─ authFetch() calls buildAuthHeaders()
         │  │
         │  └─ getStoredAccessToken()
         │     └─ localStorage.getItem('boka_auth_access_token')
         │     └─ Returns: "eyJhbGciOi..." ✓
         │
         ├─ buildAuthHeaders() returns:
         │  {
         │    'Content-Type': 'application/json',
         │    'Authorization': 'Bearer eyJhbGciOi...',  ← TOKEN ADDED
         │    'X-Tenant-ID': '123e4567...'
         │  }
         │
         └─ fetch('/api/chats', {
              headers: { Authorization: 'Bearer ...' },
              method: 'GET'
            })

750ms  → HTTP Request sent to server:
         GET /api/chats?tenant_id=123
         Headers:
           Authorization: Bearer eyJhbGciOi... ✓
           X-Tenant-ID: 123e4567...
           Content-Type: application/json

┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Server-Side Auth Validation                              │
│ File: src/lib/error-handling/route-handler.ts                   │
└─────────────────────────────────────────────────────────────────┘

755ms  → API route handler (src/app/api/chats/route.ts):
         │
         ├─ createHttpHandler() wrapper checks auth
         │  │
         │  ├─ const authHeader = request.headers.get('authorization')
         │  │  └─ Returns: "Bearer eyJhbGciOi..." ✓
         │  │
         │  ├─ if (!authHeader.startsWith('Bearer ')) {
         │  │    ✗ FAIL ← Would return 401 here
         │  │  }
         │  │
         │  ├─ const token = authHeader.slice(7)  // Remove "Bearer "
         │  │  └─ token = "eyJhbGciOi..."
         │  │
         │  ├─ const supabase = getSupabaseRouteHandlerClient()
         │  │
         │  └─ const { data: { user } } = await supabase.auth.getUser(token)
         │     └─ Verify token signature with Supabase
         │     └─ Returns: { id: '...', email: 'user@...', ... } ✓
         │
         ├─ Query tenant_users table:
         │  {
         │    user_id: user.id,
         │    role: 'owner',
         │    tenant_id: '123e4567',
         │    permissions: ['read_chats', ...]
         │  }
         │
         └─ Auth validation passed ✓

760ms  → Execute actual handler:
         const { data: chats } = await ctx.supabase
           .from('chats')
           .select('*')
           .eq('tenant_id', ctx.userData.tenant_id)

770ms  → Response sent to client:
         200 OK
         Body: { data: [ { customer_id: '...', customer_name: '...', ... } ] }

780ms  → ChatsList component:
         │
         ├─ authFetch() promise resolves
         ├─ response.data contains chats
         ├─ setData(response.data)
         └─ Component re-renders with chat list ✓

User sees: Chat list loaded successfully!
```

---

## Current Issues & Status

### ✅ WORKING CORRECTLY

1. **Sign-in flow** - Tokens stored in localStorage
2. **Token persistence** - Available across page reloads
3. **Client API calls** - authFetch() adds Authorization header
4. **Server validation** - Route handlers verify token
5. **Multi-tenant context** - X-Tenant-ID header included

### ⚠️ POTENTIAL ISSUES (Already Fixed by Recent Changes)

1. **Race condition** - Components rendering before token available
   - **Fix Applied:** DashboardLayoutClient now waits for token (see AUTH_TIMING_FIX_SUMMARY.md)
   - **Status:** ✅ RESOLVED

2. **Legacy middleware** - hipaaMiddleware looks for 'session-token' cookie
   - **Impact:** None (returns null, doesn't block)
   - **Status:** Harmless but could be cleaned up

3. **Unused cookies** - Supabase SSR adapter sets cookies we don't use
   - **Impact:** None (cookies are ignored)
   - **Status:** Could be optimized

### 🔴 CRITICAL VULNERABILITIES MITIGATED

1. **XSS Attack** - localStorage accessible to JavaScript
   - **Mitigation:** Tokens not used in HTML attributes, only in JS
   - **Next Step:** Consider httpOnly cookies for Supabase tokens

2. **CSRF Attack** - No CSRF tokens in POST requests
   - **Status:** Need to add CSRF protection

3. **Token Expiry** - No refresh token handling
   - **Status:** Need to implement token refresh

---

## Comparison: localStorage vs Cookies vs SessionStorage

```
┌────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Feature        │ localStorage     │ Cookies          │ sessionStorage   │
├────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Lifetime       │ Forever          │ Expires at set   │ Page close       │
│                │ (manual clear)   │ time/max-age     │ (automatic)      │
│────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Scope          │ Same domain      │ Can limit to     │ Same domain      │
│                │ Same port        │ path/domain      │ Same tab only    │
│────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Size Limit     │ ~5-10MB          │ ~4KB             │ ~5-10MB          │
│────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Sent with      │ NO (manual)      │ YES (automatic)  │ NO (manual)      │
│ HTTP requests  │                  │                  │                  │
│────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ JavaScript     │ YES (window.     │ YES (document.   │ YES (window.     │
│ accessible     │ localStorage)    │ cookie)          │ sessionStorage)  │
├────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ httpOnly flag  │ N/A (always      │ YES (can prevent │ N/A (always      │
│ prevents JS    │ accessible)      │ JS access)       │ accessible)      │
├────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Secure flag    │ N/A (no HTTPS    │ YES (HTTPS only) │ N/A (no HTTPS    │
│ (HTTPS only)   │ requirement)     │                  │ requirement)     │
│────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ XSS Vulnerable │ YES              │ YES (unless      │ YES              │
│                │ (without httpOnly)│ httpOnly)        │ (without httpOnly)│
├────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ CSRF Vulnerable│ NO (not auto     │ YES (auto sent)  │ NO (not auto     │
│                │ sent)            │ Requires CSRF    │ sent)            │
│                │                  │ token to prevent │                  │
│────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Use Case       │ Non-sensitive    │ Session IDs      │ Temporary data   │
│                │ app state        │ (with httpOnly)  │ for this session │
│────────────────┼──────────────────┼──────────────────┼──────────────────┘
```

---

## Your System: Why localStorage Works Here

**✅ PROS:**
1. **Simple** - No server cookie handling needed
2. **Explicit** - Only sent when we explicitly call authFetch()
3. **Flexible** - Can customize headers per-request
4. **Clear** - Easy to debug (visible in DevTools)

**❌ CONS:**
1. **XSS Risk** - JWT visible in DevTools/localStorage
2. **No CSRF Protection** - But not needed since not auto-sent
3. **No httpOnly** - Can be accessed by malicious JavaScript
4. **Manual Refresh** - No automatic token refresh mechanism

---

## Recommendations for Improvement

### 1. SHORT TERM (Already Applied)

✅ **Add auth readiness check** - Wait for token before rendering
   - File: `src/components/DashboardLayoutClient.tsx`
   - Status: IMPLEMENTED

### 2. MEDIUM TERM (Recommended)

⚠️ **Add Token Refresh Logic**
```typescript
// In authFetch():
if (response.status === 401) {
  // Try to refresh token
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    // Retry request with new token
    return authFetch(url, options);
  } else {
    // Token expired, redirect to login
    router.push('/auth/signin');
  }
}
```

⚠️ **Add CSRF Protection**
```typescript
// For POST/PUT/PATCH/DELETE requests:
const csrfToken = document.querySelector('[name="_csrf"]')?.value;
headers['X-CSRF-Token'] = csrfToken;
```

⚠️ **Implement Token Rotation**
```typescript
// Before token expires, get new one:
setInterval(async () => {
  const newToken = await getNewToken();
  setStoredAccessToken(newToken);
}, TOKEN_REFRESH_INTERVAL);
```

### 3. LONG TERM (Consider for Major Refactor)

🔐 **Migrate to HttpOnly Cookies for Auth Token**
```typescript
// Remove localStorage token
// Move to httpOnly cookie set by server

// Benefits:
// - Token not visible in DevTools
// - Can't be stolen by XSS
// - Browser auto-sends with requests (if configured)
// 
// Tradeoff:
// - Need to use session refresh mechanism
// - Can't control headers per-request
// - CSRF vulnerability (mitigated with CSRF token)
```

---

## Summary Table

| Component | Location | Purpose | Current Status |
|-----------|----------|---------|-----------------|
| Token Storage | `src/lib/auth/token-storage.ts` | Read/write 5 auth keys to localStorage | ✅ Working |
| Auth API Client | `src/lib/auth/auth-api-client.ts` | Wrapper around fetch with auth header | ✅ Working |
| Auth Headers | `src/lib/auth/auth-headers.ts` | Build Authorization header | ✅ Working |
| Auth Manager | `src/lib/auth/auth-manager.ts` | Orchestrate sign-in flow | ✅ Working |
| Callback Page | `src/app/auth/callback/page.tsx` | Process OAuth callback | ✅ Working |
| Route Handler | `src/lib/error-handling/route-handler.ts` | Validate auth on API calls | ✅ Working |
| Supabase SSR | `src/lib/supabase/server.ts` | Manage Supabase client | ⚠️ Mostly unused |
| Middleware | `src/middleware/hipaaMiddleware.ts` | Check session cookie (legacy) | ⚠️ Harmless |
| Dashboard Layout | `src/components/DashboardLayoutClient.tsx` | Wait for auth token before rendering | ✅ Fixed |

---

## Quick Reference: How to Add a New Authenticated API Call

### 1. Create API Route
```typescript
// src/app/api/example/route.ts
import { createHttpHandler } from '@/lib/error-handling/route-handler';

export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.user = authenticated user from token
    // ctx.userData = role, permissions, tenant_id
    
    const { data } = await ctx.supabase
      .from('table')
      .select('*');
    
    return { data };
  },
  'GET',
  { auth: true }  // ← Requires auth
);
```

### 2. Call from Component
```typescript
// In any client component:
import { authFetch } from '@/lib/auth/auth-api-client';

const { data, error } = await authFetch('/api/example');
```

### 3. Headers Automatically Included
```
GET /api/example HTTP/1.1
Authorization: Bearer eyJhbGciOi...   ← Added by authFetch()
X-Tenant-ID: 123e4567...              ← Added by buildAuthHeaders()
Content-Type: application/json        ← Added by buildAuthHeaders()
```

That's it! No manual header management needed.
