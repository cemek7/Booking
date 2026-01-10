# Auth Storage: localStorage vs Cookies - Decision Framework

## Current System: localStorage

Your app uses **localStorage for tokens** with explicit **Authorization headers** on API calls.

---

## Comparison: localStorage vs Cookies

### localStorage (CURRENT)

```
PROS:
✅ Simple - No server-side cookie management
✅ Explicit - Only sent when we call authFetch()
✅ Flexible - Can customize per-request
✅ Cross-tab - Shared between browser tabs
✅ Easy to debug - Visible in DevTools
✅ No CSRF risk - Not auto-sent with requests

CONS:
❌ XSS Risk - Accessible to malicious JavaScript
❌ Visible in DevTools - Not httpOnly
❌ Manual refresh - No built-in token refresh
❌ Storage limits - 5-10MB per domain
```

### Cookies (ALTERNATIVE)

```
PROS:
✅ httpOnly - Can't be accessed by JavaScript (XSS protection)
✅ Secure flag - HTTPS-only
✅ Auto-send - Browser sends automatically
✅ Expiry - Built-in max-age handling
✅ Server control - Set from server, not client

CONS:
❌ CSRF risk - Must be mitigated with CSRF tokens
❌ Complex - Requires careful configuration
❌ Visible in transit - Can be intercepted (unless HTTPS)
❌ Less flexible - Can't customize per-request
❌ Storage limits - 4KB max per cookie
```

### SessionStorage (RARELY USED)

```
PROS:
✅ Auto-clear - Deleted when tab closes
✅ Simple - Like localStorage

CONS:
❌ Tab-specific - Not shared between tabs
❌ Session-only - Lost on refresh
❌ Same XSS risk - Accessible to JavaScript
```

---

## When to Use Each

### Use localStorage When:

1. ✅ **Building SPA (Single Page App)** - Your use case
   - Token doesn't change often
   - User stays in app for extended session
   - Security handled at server level

2. ✅ **Using Authorization Header** - Your pattern
   - Explicit control over when token is sent
   - Can add CSRF tokens for POST/PUT/DELETE
   - Server can validate every request

3. ✅ **No sensitive data in localStorage**
   - Only auth token stored
   - No passwords, API keys, PII
   - Token expires anyway

4. ✅ **XSS prevention handled elsewhere**
   - CSP (Content Security Policy) enabled
   - Input sanitization in place
   - Trusted JavaScript only

---

### Use Cookies When:

1. ❌ **Token is highly sensitive**
   - Can't afford any XSS exposure
   - Need maximum security
   - Compliance requirements (HIPAA, PCI)

2. ❌ **You need auto-refresh**
   - Token expires frequently
   - Need seamless user experience
   - Can't handle manual refresh

3. ❌ **Building traditional server-rendered app**
   - Forms and page reloads common
   - Sessions managed on server
   - Cookies auto-sent with requests

---

## Your System Analysis

### ✅ Why localStorage Works Here

1. **Explicit Control**
   - Token only sent when `authFetch()` called
   - No accidental token leakage
   - Can add security checks before sending

2. **Server Validation**
   - Every API route verifies token signature
   - Role/permissions checked on every request
   - Bad token immediately rejected

3. **Limited Sensitive Data**
   - Only JWT token in storage
   - Not passwords or secrets
   - User data non-sensitive (email, role)

4. **XSS Defense**
   - Even if XSS happens:
     - Attacker can read token (but it's short-lived)
     - Can't access server (token verified on backend)
     - Limited damage (app state, not data)

5. **CSRF Not a Risk**
   - Token not auto-sent
   - POST/PUT/DELETE require explicit authFetch()
   - CSRF tokens would be redundant here

---

## Flow Comparison

### localStorage Flow (Current)

```
┌─────────────────────────────────────────────────────────────┐
│ BROWSER                                                      │
│                                                              │
│  localStorage:                                               │
│  boka_auth_access_token = "eyJhbGciOi..."                  │
│                                                              │
│  Component:                                                  │
│  authFetch('/api/data')                                     │
│    ↓                                                         │
│    buildAuthHeaders()                                       │
│      ↓                                                       │
│      localStorage.getItem('boka_auth_access_token')        │
│        ↓                                                     │
│        Authorization: Bearer eyJhbGciOi...                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ SERVER                                                       │
│                                                              │
│  Receive: Authorization: Bearer eyJhbGciOi...             │
│                                                              │
│  Extract: token = "eyJhbGciOi..."                           │
│                                                              │
│  Verify: Supabase.auth.getUser(token)                      │
│    ↓ (signature check)                                      │
│    ✓ Valid? Continue                                        │
│    ✗ Invalid? Return 401                                    │
│                                                              │
│  Query: tenant_users table                                  │
│    → Get role, permissions                                  │
│                                                              │
│  Execute: API handler                                       │
│                                                              │
│  Return: 200 + data                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Cookie Flow (Alternative)

```
┌─────────────────────────────────────────────────────────────┐
│ BROWSER                                                      │
│                                                              │
│  Cookies (httpOnly):                                        │
│  auth_token = "eyJhbGciOi..."  (not accessible via JS)     │
│                                                              │
│  Component:                                                  │
│  fetch('/api/data', {                                       │
│    credentials: 'include'  ← Auto-send cookies             │
│  })                                                          │
│                                                              │
│  (Token sent automatically by browser)                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ SERVER                                                       │
│                                                              │
│  Receive: Cookie: auth_token=eyJhbGciOi...                │
│                                                              │
│  Extract: token = request.cookies.get('auth_token')        │
│                                                              │
│  Verify: Supabase.auth.getUser(token)                      │
│    ↓ (signature check)                                      │
│    ✓ Valid? Continue                                        │
│    ✗ Invalid? Return 401                                    │
│                                                              │
│  Check: CSRF token (prevent cross-site attacks)            │
│    request.headers.get('X-CSRF-Token')                     │
│    ✓ Valid? Continue                                        │
│    ✗ Missing? Return 403                                    │
│                                                              │
│  Query: tenant_users table                                  │
│    → Get role, permissions                                  │
│                                                              │
│  Execute: API handler                                       │
│                                                              │
│  Return: 200 + data                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Threat Assessment

### XSS Attack (JavaScript Injection)

**localStorage Approach:**
```
Attacker injects: <script>alert(localStorage.boka_auth_access_token)</script>

Result: Token exposed in console
Impact: 🟡 MEDIUM
  - Token can be used to call API
  - But limited to current tenant
  - Token expires eventually
  - Server logs all access

Mitigation:
  ✓ CSP (Content Security Policy)
  ✓ Input sanitization
  ✓ Trusted dependencies
  ✓ Regular security audits
```

**Cookie Approach:**
```
Attacker injects: <script>alert(document.cookie)</script>

Result: ❌ httpOnly prevents access
Impact: 🟢 MINIMAL
  - Attacker can't read token
  - Can still make requests (CSRF needed)

Mitigation:
  ✓ httpOnly flag (prevents JS access)
  ✓ Secure flag (HTTPS only)
  ✓ CSRF tokens (prevent cross-site)
  ✓ SameSite attribute (prevent cross-site cookies)
```

### CSRF Attack (Cross-Site Request Forgery)

**localStorage Approach:**
```
Attacker creates: <img src="https://yourapp.com/api/delete?id=123" />

Result: 🟢 NO CSRF RISK
  - Browser doesn't auto-send Authorization header
  - Request fails (no auth token)
  - API call blocked

Why it's safe:
  ✓ Token only sent by authFetch()
  ✓ No automatic token inclusion
```

**Cookie Approach:**
```
Attacker creates: <img src="https://yourapp.com/api/delete?id=123" />

Result: 🔴 CSRF RISK
  - Browser auto-sends cookies
  - Request includes auth token
  - API call succeeds (delete happens!)

Why it's risky:
  ✗ Cookies auto-sent with cross-origin requests
  ✗ Attacker can trigger actions
  
Mitigation:
  ✓ CSRF tokens (random token in form)
  ✓ SameSite attribute (prevent cross-site cookies)
  ✓ POST/PUT/DELETE only (not GET)
```

### Token Compromise

**Both approaches:**
```
If token is compromised:
  1. Attacker has access to user's account
  2. Can read/modify user's data
  3. Can act as the user

Severity: 🔴 CRITICAL
Why? 
  - Token is equivalent to password
  - Single access token = full account access

Mitigation (both):
  ✓ Token expiry (24 hours recommended)
  ✓ Refresh token rotation
  ✓ Logout on suspicious activity
  ✓ IP address tracking
  ✓ Device fingerprinting
```

---

## Decision Matrix

```
                          localStorage    Cookies
─────────────────────────────────────────────────────────────
XSS Resistant             ❌ Poor         ✅ Good (httpOnly)
CSRF Resistant            ✅ Good         ⚠️ Requires CSRF token
Simple to implement       ✅ Easy         ⚠️ Complex
Flexible API calls        ✅ Yes          ❌ No
Auto-sends token          ❌ No           ✅ Yes
Support refresh token     ❌ Manual       ✅ Automatic
Mobile app friendly       ✅ Yes          ❌ Limited
SSR friendly              ❌ No           ✅ Yes
DevTools visibility       ⚠️ Visible      ✅ Hidden
─────────────────────────────────────────────────────────────

YOUR SCENARIO (SPA + Explicit Auth Header):
  ✅ localStorage is GOOD CHOICE
```

---

## Recommendations for Your System

### SHORT TERM (No Changes Needed)

✅ **Keep localStorage approach**
- Working correctly
- Race condition fixed
- No security issues if XSS prevented

### MEDIUM TERM (Recommended)

⚠️ **Add these safeguards:**

1. **Content Security Policy (CSP)**
   ```
   Prevent inline scripts
   Prevent external script injection
   Reduces XSS attack surface
   ```

2. **Token Expiry & Refresh**
   ```typescript
   // Implement token refresh mechanism
   const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 min
   const TOKEN_LIFETIME = 60 * 60 * 1000; // 60 min
   
   setInterval(async () => {
     if (isTokenExpiringSoon()) {
       const newToken = await refreshToken();
       setStoredAccessToken(newToken);
     }
   }, REFRESH_INTERVAL);
   ```

3. **CSRF Protection for Form Submissions**
   ```typescript
   // For POST/PUT/PATCH/DELETE via forms
   const csrfToken = document.querySelector(
     '[name="_csrf"]'
   )?.value;
   
   headers['X-CSRF-Token'] = csrfToken;
   ```

### LONG TERM (Optional Refactor)

🔐 **Consider httpOnly cookies IF:**
- Compliance requirements (HIPAA, PCI-DSS)
- XSS becomes major concern
- Need maximum security
- Resources available for refactor

**Migration steps:**
1. Create server-side token refresh endpoint
2. Move token to httpOnly cookie
3. Add CSRF token to all forms
4. Update authFetch() to use credentials: 'include'
5. Add SameSite and Secure flags to cookies

---

## Summary

| Aspect | Your Choice | Assessment |
|--------|----------|-----------|
| Storage Method | localStorage | ✅ Appropriate for SPA |
| Token Transmission | Authorization Header | ✅ Secure & Flexible |
| Current Issues | Race condition (FIXED) | ✅ Resolved |
| Security Posture | Good with prevention | ✅ Acceptable |
| XSS Vulnerability | Possible (if XSS happens) | ⚠️ Mitigate with CSP |
| CSRF Vulnerability | Not vulnerable | ✅ Safe |
| Token Refresh | Not implemented | ⚠️ Needed long-term |

**Verdict: Keep localStorage, add token refresh, maintain security hardening**

Your current approach is **solid and appropriate** for your use case. The race condition fix ensures it works reliably. No urgent changes needed, but implement token refresh when you have capacity.
