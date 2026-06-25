# Missing Authorization Error - Root Cause & Fix

## Error Found
```json
{
  "error": "missing_authorization",
  "code": "missing_authorization",
  "message": "Authorization header is missing or malformed",
  "timestamp": "2025-12-19T17:43:31.644Z"
}
```

---

## Root Cause

Four components were making API calls without including the Authorization header:

### 1. **TenantSettingsClient.tsx** (CRITICAL)
- **Line 36**: `fetch()` without Authorization header
- **Endpoint**: PUT `/api/admin/tenant/{id}/settings`
- **Status**: ❌ BROKEN - No token sent at all

```typescript
// BEFORE (WRONG):
await fetch(`/api/admin/tenant/${tenantId}/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ... }),
});

// AFTER (FIXED):
await authFetch(`/api/admin/tenant/${tenantId}/settings`, {
  method: 'PUT',
  body: JSON.stringify({ ... }),
});
```

---

### 2. **TenantSettings.tsx** (MIXED)
- **Line 21 (GET)**: Plain `fetch()` without auth
- **Line 92 (PUT)**: Complex Supabase client import that might fail

**GET Issue:**
```typescript
// BEFORE (WRONG):
const res = await fetch(`/api/admin/tenant/${tenantId}/settings`, { method: 'GET' });

// AFTER (FIXED):
const res = await authFetch(`/api/admin/tenant/${tenantId}/settings`, { method: 'GET' });
```

**PUT Issue:**
```typescript
// BEFORE (COMPLEX):
try {
  const mod = await import('@/lib/supabase/server');
  const sb = mod.getBrowserSupabase();
  const { data } = await sb.auth.getSession();
  token = data?.session?.access_token ?? null;
} catch (e) {
  console.warn('supabase client unavailable for save', e);
}

// AFTER (SIMPLE):
// authFetch() handles token extraction from localStorage automatically
const resp = await authFetch(`/api/admin/tenant/${tenantId}/settings`, {
  method: 'PUT',
  body: JSON.stringify(payload),
});
```

---

### 3. **ReservationLogs.tsx** (WORKING BUT COMPLEX)
- **Line 44**: Manual Supabase token extraction before `fetch()`
- **Status**: ⚠️ Works but needs cleanup

```typescript
// BEFORE (MANUAL):
const sessionResp = await supabase.auth.getSession();
const token = (sessionResp as { ... }).data?.session?.access_token;
const res = await fetch('/api/admin/reservation-logs?' + params.toString(), {
  headers: { Authorization: `Bearer ${token}` },
});

// AFTER (CLEANER):
const res = await authFetch('/api/admin/reservation-logs?' + params.toString());
```

---

### 4. **OwnerLLMMetrics.client.tsx** (WORKING BUT REDUNDANT)
- **Lines 18, 33**: Manual Supabase token extraction before `fetch()`
- **Status**: ⚠️ Works but duplicates auth logic

```typescript
// BEFORE (MANUAL):
const supabase = getBrowserSupabase();
const s = await supabase.auth.getSession();
const token = (s as any)?.data?.session?.access_token;
const headers: Record<string, string> = {};
if (token) headers['Authorization'] = `Bearer ${token}`;
const r = await fetch(url, { headers });

// AFTER (CLEANER):
const r = await authFetch(url);
```

---

## Why This Happened

1. **TenantSettingsClient.tsx** - Completely forgot to add Authorization header
2. **TenantSettings.tsx** - Mixed approach:
   - GET: No auth (worked in dev, breaks in prod)
   - PUT: Tried to use Supabase browser client (fragile, not needed)
3. **ReservationLogs.tsx** - Predated the `authFetch()` pattern
4. **OwnerLLMMetrics.client.tsx** - Predated the `authFetch()` pattern

---

## The Fix

Changed all four components to use `authFetch()` instead of manual `fetch()`:

### What `authFetch()` Does Automatically:
✅ Reads token from localStorage (`boka_auth_access_token`)  
✅ Adds `Authorization: Bearer {token}` header  
✅ Adds `X-Tenant-ID` header for multi-tenant context  
✅ Returns typed `ApiResponse<T>` with `.data`, `.error`, `.status`  
✅ Handles JSON parsing automatically  

### Files Modified:
1. ✅ `src/components/TenantSettingsClient.tsx` - Import + use authFetch on line 36
2. ✅ `src/components/TenantSettings.tsx` - Import + use authFetch on lines 21 & 92
3. ✅ `src/components/ReservationLogs.tsx` - Import + use authFetch on line 44
4. ✅ `src/components/OwnerLLMMetrics.client.tsx` - Import + use authFetch on lines 18 & 33

---

## How to Use authFetch()

### Simple GET:
```typescript
const res = await authFetch('/api/admin/data');
if (res.status === 200) {
  console.log(res.data);
} else {
  console.error(res.error?.message);
}
```

### POST with Body:
```typescript
const res = await authFetch('/api/admin/update', {
  method: 'POST',
  body: { name: 'New Name' },
});
```

### Response Handling:
```typescript
// authFetch returns ApiResponse<T>
interface ApiResponse<T> {
  data?: T;           // Parsed JSON response
  error?: ApiError;   // Error details (status !== 200)
  status: number;     // HTTP status code
}

// Check response
if (res.status === 200) {
  // Success - use res.data
} else if (res.status === 401) {
  // Auth failed
} else {
  // Other error - check res.error
}
```

---

## Verification

All components now:
✅ Import `authFetch` from `@/lib/auth/auth-api-client`  
✅ Use `authFetch()` for all API calls  
✅ Handle `ApiResponse` type correctly (not native `Response`)  
✅ Pass Authorization header automatically  
✅ No TypeScript errors  

---

## Testing

To verify the fix works:

1. **Sign in** to the application
2. **Navigate to tenant settings** - Should load without 401 errors
3. **Update any setting** - Should save without 401 errors
4. **View reservation logs** - Should load without 401 errors
5. **View LLM metrics** - Should load without 401 errors
6. **Browser DevTools** → Network tab:
   - Check that all `/api/admin/*` requests include:
     - Header: `Authorization: Bearer eyJ...`
     - Header: `X-Tenant-ID: {tenant-id}`

---

## Summary

| Component | Issue | Fix | Status |
|-----------|-------|-----|--------|
| TenantSettingsClient.tsx | No auth header on PUT | Use authFetch() | ✅ FIXED |
| TenantSettings.tsx | No auth on GET, complex Supabase on PUT | Use authFetch() on both | ✅ FIXED |
| ReservationLogs.tsx | Manual token extraction | Use authFetch() | ✅ CLEANED UP |
| OwnerLLMMetrics.client.tsx | Manual token extraction (2 places) | Use authFetch() | ✅ CLEANED UP |

**Result:** All API calls now automatically include the Authorization header via `authFetch()`. No more "missing_authorization" errors. ✅
