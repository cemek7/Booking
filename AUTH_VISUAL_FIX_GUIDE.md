# Visual Auth Flow - Before & After

## Before: Broken Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USER JOURNEY: SIGNIN → CALLBACK → DASHBOARD → API CALL                 │
└─────────────────────────────────────────────────────────────────────────┘

STEP 1: Sign-In Page
┌──────────────────┐
│ /auth/signin     │
│ Click "Sign in"  │
└────────┬─────────┘
         │
         ├─ Browser Supabase Client
         │  createBrowserClient(url, key) ← NO COOKIE HANDLERS! ❌
         │
         └─→ Redirect to Supabase OAuth

STEP 2: OAuth Callback
┌──────────────────────────────────────────┐
│ Supabase OAuth completes                 │
│ Redirects: /auth/callback?code=xxx       │
└────────┬─────────────────────────────────┘
         │
         ├─ auth.getSessionFromUrl()
         │  ├─ Exchanges code for token ✓
         │  ├─ Tries to set session cookie...
         │  │  └─ PROBLEM: Browser client has no cookie handlers! ❌
         │  │     Supabase can't persist the cookie
         │  │
         │  └─ Session state becomes INCOMPLETE
         │
         ├─ Token extracted from incomplete session
         │  └─ Stored in localStorage ✓
         │
         └─→ Redirect to /dashboard

STEP 3: Dashboard Load
┌──────────────────────────────────┐
│ /dashboard page loaded           │
│ Components render                │
└────────┬─────────────────────────┘
         │
         ├─ TenantSettingsClient makes API call
         │  └─ fetch('/api/admin/tenant/123/settings')
         │     └─ NO AUTHORIZATION HEADER! ❌
         │
         ├─ ReservationLogs makes API call
         │  └─ fetch() with manual token extraction
         │     └─ Works but fragile
         │
         └─ OwnerLLMMetrics makes API call
            └─ fetch() with manual token extraction
               └─ Works but fragile

STEP 4: API Call
┌────────────────────────────────────────────────────────────────┐
│ Browser to Server                                              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Request Headers:                                               │
│ ├─ Authorization: Bearer {token} ✓ (if using authFetch)      │
│ └─ (missing for plain fetch!) ❌                             │
│                                                                 │
│ Server Validation:                                             │
│ ├─ Extract token                                              │
│ ├─ Verify with Supabase                                       │
│ │  └─ PROBLEM: Session state incomplete!                     │
│ │     Supabase can't validate properly ❌                     │
│ │                                                              │
│ └─ Return 401 "missing_authorization"                        │
│                                                                 │
└────────────────────────────────────────────────────────────────┘

RESULT: ❌ 401 Errors on Every API Call
```

---

## After: Fixed Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USER JOURNEY: SIGNIN → CALLBACK → DASHBOARD → API CALL (WORKING!)      │
└─────────────────────────────────────────────────────────────────────────┘

STEP 1: Sign-In Page
┌──────────────────┐
│ /auth/signin     │
│ Click "Sign in"  │
└────────┬─────────┘
         │
         ├─ Browser Supabase Client
         │  createBrowserClient(url, key, {
         │    cookies: { get, set, remove }  ✓ FIX #2
         │  })
         │
         └─→ Redirect to Supabase OAuth

STEP 2: OAuth Callback
┌──────────────────────────────────────────┐
│ Supabase OAuth completes                 │
│ Redirects: /auth/callback?code=xxx       │
└────────┬─────────────────────────────────┘
         │
         ├─ auth.getSessionFromUrl()
         │  ├─ Exchanges code for token ✓
         │  ├─ Sets session cookie
         │  │  └─ Browser client CAN persist! ✓
         │  │     document.cookie = "sb-xxx-auth-token=..."
         │  │
         │  └─ Session state COMPLETE ✓
         │
         ├─ Token extracted from complete session
         │  └─ Stored in both:
         │     ├─ Cookies (httpOnly) ✓
         │     └─ localStorage ✓
         │
         └─→ Redirect to /dashboard

STEP 3: Dashboard Load
┌──────────────────────────────────────────┐
│ /dashboard page loaded                   │
│ Components render                        │
└────────┬─────────────────────────────────┘
         │
         ├─ TenantSettingsClient makes API call
         │  └─ authFetch('/api/admin/tenant/123/settings') ✓ FIX #1
         │     └─ Automatically adds Authorization header
         │
         ├─ ReservationLogs makes API call
         │  └─ authFetch('/api/admin/reservation-logs') ✓ FIX #1
         │     └─ Automatically adds Authorization header
         │
         └─ OwnerLLMMetrics makes API call
            └─ authFetch('/api/admin/llm-usage') ✓ FIX #1
               └─ Automatically adds Authorization header

STEP 4: API Call
┌────────────────────────────────────────────────────────────────┐
│ Browser to Server                                              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Request Headers:                                               │
│ ├─ Authorization: Bearer {token} ✓ FIX #1                    │
│ ├─ X-Tenant-ID: tenant-123 ✓                                 │
│ └─ Cookie: sb-xxx-auth-token={token} ✓ FIX #2               │
│                                                                 │
│ Server Validation:                                             │
│ ├─ Extract token                                              │
│ ├─ Verify with Supabase                                       │
│ │  └─ Session state COMPLETE ✓                               │
│ │     Supabase validates successfully ✓                       │
│ │                                                              │
│ └─ Return 200 with data ✓                                    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘

RESULT: ✅ 200 OK - Everything Works!
```

---

## Side-by-Side Comparison

### Browser Client Configuration

```
BEFORE (BROKEN):                    AFTER (FIXED):
────────────────────────           ──────────────────────────────
createBrowserClient(                createBrowserClient(
  supabaseUrl,                      supabaseUrl,
  supabaseAnonKey                   supabaseAnonKey,
)                                   {
                                      cookies: {
                                        get: (name) => { ... },
                                        set: (name, value, opts) => { ... },
                                        remove: (name, opts) => { ... }
                                      }
                                    }
                                    )
```

### API Call Pattern

```
BEFORE (MIXED):                     AFTER (CONSISTENT):
────────────────────────────        ──────────────────────────
// Some components:                 // All components:
fetch('/api/admin/x',               authFetch('/api/admin/x',
  {                                   {
    method: 'GET'                     method: 'GET'
    // No auth!                       // auth automatic!
  }                                   }
)                                   )

// Other components:
const token = await ...             // Clean, consistent
  sb.auth.getSession()
fetch('/api/admin/x',
  {
    headers: {
      Authorization: token
    }
  }
)
```

---

## Data Flow Diagram

### Before: Multiple Paths (Broken)

```
                          ┌─ localStorage (token)
                          │  └─ authFetch() reads it
                          │     └─ Server validation FAILS
                          │        (session incomplete)
User Signs In             │        └─ 401 ❌
     │
     ├─ Browser Client (No Cookies)
     │  └─ Session NOT persisted
     │
     ├─ /api/admin/check
     │  └─ Stores in localStorage
     │
     └─ Dashboard Load
        ├─ authFetch() ✓
        │  └─ Works
        ├─ fetch() ❌
        │  └─ Missing auth
        └─ Manual fetch ⚠️
           └─ Fragile
```

### After: Single, Consistent Path (Fixed)

```
User Signs In
     │
     ├─ Browser Client + Cookies ✓
     │  └─ Session persisted to cookies
     │
     ├─ /api/admin/check
     │  └─ Stores in localStorage
     │
     └─ Dashboard Load
        ├─ authFetch() ✓
        │  ├─ Reads from localStorage
        │  ├─ Adds Authorization header
        │  └─ Server validates with cookies
        ├─ authFetch() ✓
        │  └─ Same pattern
        └─ authFetch() ✓
           └─ Same pattern
           
All API Calls:
└─ Authorization header ✓
   └─ Cookie sent ✓
      └─ Session complete ✓
         └─ Validation succeeds ✓
            └─ 200 OK ✓
```

---

## Cookie vs localStorage Timeline

```
TIME AXIS: Sign-In → Callback → Dashboard → API Call

     0ms: Sign-In Click
     ├─ Browser Client created
     │  └─ Has cookie handlers ✓ FIX #2
     │
    100ms: OAuth Redirect
     │
    500ms: OAuth Callback
     │  ├─ Browser Client exchanges code
     │  ├─ Cookies set: sb-xxx-auth-token ✓ FIX #2
     │  │  └─ Persists across page reloads
     │  │
     │  └─ localStorage set: boka_auth_* ✓
     │     └─ Available immediately to JS
     │
    700ms: Dashboard Load
     │  ├─ Components render
     │  └─ authFetch() calls start
     │     ├─ Read from localStorage ✓
     │     ├─ Add Authorization header ✓ FIX #1
     │     └─ Send request with cookies
     │
   1000ms: Server Receives Request
     │  ├─ Extract Authorization header ✓
     │  ├─ Verify with Supabase
     │  │  └─ Uses cookies to validate session ✓ FIX #2
     │  │
     │  └─ Return 200 ✓
     │
   1200ms: Component Updates
     │  └─ Data received, UI updates
     │
   SUCCESS: ✅ Full auth flow works!
```

---

## Security Model

```
BROWSER                              SERVER
───────────────────────────────────────────

localStorage:                        Validation:
├─ boka_auth_access_token  ──────→  ├─ Extract token
│  (readable by JS)               │  ├─ Verify signature
├─ boka_auth_tenant_id            │  ├─ Check expiry
├─ boka_auth_role                 │  └─ Query database
└─ boka_auth_user_data            │
                                  ├─ Read Cookies:
Cookies:                          │  └─ sb-xxx-auth-token
├─ sb-xxx-auth-token    ────────→│  (httpOnly, secure)
│  (httpOnly, secure)            │
│  (not readable by JS)           └─ Return data or 401
│
Sent with Every Request:
├─ Authorization: Bearer {token}
├─ X-Tenant-ID: {tenant-id}
└─ Cookie: sb-xxx-auth-token={token}
```

---

## Error Recovery

### Before: Stuck

```
❌ 401 Error
   │
   └─ Browser client has no cookies?
      └─ Session incomplete?
         └─ Clear cache and try again?
            └─ If still fails... no idea what's wrong ❌
```

### After: Clear Diagnosis

```
❌ 401 Error?
   │
   ├─ Check browser cookies
   │  └─ Should have: sb-xxx-auth-token
   │
   ├─ Check localStorage
   │  └─ Should have: boka_auth_access_token
   │
   ├─ Check Authorization header
   │  └─ Should include: Authorization: Bearer {...}
   │
   └─ Check component
      └─ Should use: authFetch() ✓
         └─ Not: fetch()
```

---

## Summary Table

| Aspect | Before | After | Fix |
|--------|--------|-------|-----|
| **Browser Client Cookies** | Not configured ❌ | Configured ✅ | FIX #2 |
| **Session Persistence** | Broken ❌ | Works ✅ | FIX #2 |
| **Component Auth Pattern** | Mixed (fetch + authFetch) ❌ | Unified (authFetch) ✅ | FIX #1 |
| **Authorization Header** | Some missing ❌ | All included ✓ | FIX #1 |
| **Server Validation** | Invalid session ❌ | Valid session ✓ | FIX #2 |
| **API Errors** | 401 errors ❌ | 200 OK ✓ | Both |
| **Developer Experience** | Confusing ❌ | Clear & Consistent ✓ | Both |

---

## What You Need to Know

1. **Two fixes applied**
   - FIX #1: Components now use authFetch() (automatic Authorization header)
   - FIX #2: Browser client now has cookie handlers (proper session persistence)

2. **Both fixes work together**
   - localStorage provides client-side context
   - Cookies provide server-side session validation
   - Authorization header carries the token
   - They're all in sync now

3. **How to verify it works**
   - Clear cookies/localStorage
   - Sign in again
   - Check DevTools for both cookies and localStorage
   - Make an API call - should be 200, not 401

4. **If you see 401 again**
   - Check Authorization header is present
   - Check token is in localStorage
   - Check session cookie is set
   - See AUTH_TROUBLESHOOTING_GUIDE.md for detailed debugging

---

This visual should help you understand exactly what was broken and how both fixes work together to make it work.
