# Dashboard Components Query Client & Role Fix Summary

## Changes Made

### 1. **QueryClientProvider Added to DashboardLayoutClient** ✅
**File:** [src/components/DashboardLayoutClient.tsx](src/components/DashboardLayoutClient.tsx)

- Added `QueryClient` and `QueryClientProvider` imports
- Created singleton `queryClient` with proper defaults:
  - staleTime: 5 minutes
  - gcTime: 10 minutes (formerly cacheTime)
- Wrapped `<TenantProvider>` with `<QueryClientProvider>`

**Impact:** All dashboard components using `useQuery`/`useMutation` will now work:
- ChatsList
- CustomersList
- StaffList
- ServicesList
- IntegratedBookingForm
- ProductFilters / CreateProductModal / AdvancedSearch

### 2. **Role Loading Fixed in Middleware** ✅
**File:** [src/middleware/unified/auth/auth-handler.ts](src/middleware/unified/auth/auth-handler.ts)

**Changes:**
- Removed hardcoded `role: 'staff'` default
- Now queries `tenant_users` by `user_id` to get actual role
- Uses JWT's `user_id` (available on server) instead of localStorage's `tenantId`

**Two locations updated:**
1. **Lines 140-162** - Supabase session check
   - Queries: `SELECT role FROM tenant_users WHERE user_id = authUser.id`
   - Sets: `role: userRole || 'staff'` (actual role, fallback only if not found)

2. **Lines 183-205** - Bearer token fallback
   - Same query logic by `tokenUser.id`
   - Sets: `role: userRole || 'staff'`

**Result:** 
- Owner users now get `role: 'owner'` (not 'staff')
- Manager users get `role: 'manager'`
- Staff users get `role: 'staff'`
- Users not in tenant_users still get default 'staff' (graceful fallback)

## Components Protected by QueryClientProvider

All of these components are now protected and won't throw "No QueryClient set" errors:

| Component | Location | Query Hooks |
|-----------|----------|------------|
| ChatsList | src/components/chat/ChatsList.tsx | useQuery |
| CustomersList | src/components/customers/CustomersList.tsx | useQuery, useMutation, useQueryClient |
| StaffList | src/components/tenants/StaffList.tsx | useQuery, useMutation, useQueryClient |
| ServicesList | src/components/services/ServicesList.tsx | useQuery, useMutation, useQueryClient |
| IntegratedBookingForm | src/components/booking/IntegratedBookingForm.tsx | useMutation |
| ProductFilters | src/components/admin/products/ProductFilters.tsx | useQuery |
| CreateProductModal | src/components/admin/products/CreateProductModal.tsx | useQuery, useMutation |
| AdvancedSearch | src/components/admin/products/AdvancedSearch.tsx | useQuery |
| RealtimeSubscriptions | src/components/RealtimeSubscriptions.tsx | useQueryClient |

## Architecture Flow

```
GET /dashboard
  ↓
Middleware (auth-handler.ts)
  ├─ 1. Check Supabase session (cookies)
  ├─ 2. Query tenant_users by user_id → Get actual role (owner/manager/staff)
  ├─ 3. Set context.user.role to actual role
  └─ Return 200 (authenticated)

Page loads in browser
  ↓
DashboardLayoutClient (with QueryClientProvider)
  ├─ Wraps TenantProvider
  ├─ Wraps DashboardLayoutContent & all children
  └─ All useQuery hooks now work properly

Components render
  ├─ ChatsList → useQuery for /api/chats
  ├─ CustomersList → useQuery for /api/customers
  ├─ StaffList → useQuery for staff data
  └─ etc...
```

## Testing Points

1. **Owner Sign-In:**
   - Should see owner role in middleware context
   - Dashboard should load without QueryClient errors
   - All CRUD operations in dashboard should work

2. **Manager Sign-In:**
   - Should see manager role in middleware context
   - Appropriate features shown/hidden based on role

3. **Staff Sign-In:**
   - Should see staff role in middleware context
   - Limited view in dashboard

4. **No Role in tenant_users:**
   - Should gracefully fallback to 'staff'
   - Component still renders (no crash)

---

**Status:** ✅ **READY FOR TEST**
All fixes applied and compiled successfully.
