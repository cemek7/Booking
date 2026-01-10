# API Routes tenantId Fix Summary

## Problem Identified
Many API routes were trying to access `ctx.user!.tenantId` which is set to `undefined` by the route-handler. This causes 500 errors when APIs try to filter by tenant_id.

## Solution Architecture
The middleware and route-handler now follow this pattern:
1. Frontend uses `authFetch()` which automatically sends `X-Tenant-ID` header
2. API routes extract tenantId from `X-Tenant-ID` header OR fall back to `ctx.user?.tenantId`
3. This works for both Client Components (have access token) and Server Components

## Routes FIXED ✅

### Critical Routes (Dashboard-facing)
✅ **GET /api/services** - Extract tenantId from X-Tenant-ID header
✅ **POST /api/services** - Extract tenantId from X-Tenant-ID header
✅ **PATCH /api/services** - Extract tenantId from X-Tenant-ID header
✅ **DELETE /api/services** - Extract tenantId from X-Tenant-ID header

✅ **GET /api/customers** - Extract tenantId from X-Tenant-ID header
✅ **POST /api/customers** - Extract tenantId from X-Tenant-ID header
✅ **PATCH /api/customers** - Extract tenantId from X-Tenant-ID header
✅ **DELETE /api/customers** - Extract tenantId from X-Tenant-ID header

✅ **GET /api/reservations** - Already has fallback: `url.searchParams.get('tenant_id') || ctx.user!.tenantId`
✅ **GET /api/chats** - Already has fallback: `searchParams.get('tenant_id') || ctx.user?.tenantId`

### ReservationsList Component
✅ **Fixed to use authFetch()** - Now sends Authorization header for 401 errors

## Routes NEEDING FIX ⚠️

### Tier 1 (High Priority - Called from Dashboard)
These should be fixed to use X-Tenant-ID header pattern:

**Analytics Routes:**
- [ ] GET /api/analytics/dashboard - `analyticsService.getDashboardMetrics(ctx.user!.tenantId, ...)`
- [ ] GET /api/analytics/trends - `analyticsService.getBookingTrends(ctx.user!.tenantId, ...)`
- [ ] GET /api/analytics/staff - `analyticsService.getStaffPerformance(ctx.user!.tenantId, ...)`
- [ ] GET /api/analytics/vertical - `analyticsService.getVerticalAnalytics(ctx.user!.tenantId, ...)`

**Reminders Routes:**
- [ ] GET /api/reminders/run - `.eq('tenant_id', ctx.user!.tenantId)`
- [ ] POST /api/reminders/create - `.insert({ tenant_id: ctx.user!.tenantId, ... })`

**Payment Routes:**
- [ ] POST /api/payments/retry - `.eq('tenant_id', ctx.user!.tenantId)`
- [ ] POST /api/payments/refund - `tenantId: ctx.user!.tenantId`
- [ ] POST /api/payments/reconcile - `paymentService.reconcileLedger(ctx.user!.tenantId, ...)`

**Calendar Routes:**
- [ ] POST /api/calendar/universal (2 places) - `.eq('tenant_id', ctx.user!.tenantId)`

**Jobs Routes:**
- [ ] POST /api/jobs/enqueue-reminders - `tenant_id: ctx.user!.tenantId`
- [ ] POST /api/jobs/create-recurring - tenantId validation
- [ ] GET /api/jobs - query jobs by tenant_id

**Other Routes:**
- [ ] GET /api/staff-skills - `.eq('tenant_id', ctx.user!.tenantId)`
- [ ] POST /api/staff-skills - `.insert({ tenant_id: ctx.user!.tenantId, ... })`
- [ ] GET /api/skills - `.eq('tenant_id', ctx.user!.tenantId)`
- [ ] POST /api/skills - `.insert({ tenant_id: ctx.user!.tenantId, ... })`
- [ ] GET /api/staff - `searchParams.get('tenant_id') || ctx.user!.tenantId` (ALREADY has fallback)
- [ ] GET /api/reminders/trigger - `.eq('tenant_id', ctx.user!.tenantId)`

### Tier 2 (Medium Priority - Owner/Manager Specific)
These routes are protected by roles ['owner', 'manager'] and can be fixed next:

**Owner Routes:**
- [ ] GET /api/owner/usage - `getOwnerUsage(ctx.supabase, ctx.user.tenantId)`
- [ ] GET /api/owner/staff - `getStaffData(ctx.supabase, ctx.user.tenantId)`
- [ ] POST /api/owner/staff - `inviteStaffMember(ctx.supabase, ctx.user.tenantId, ...)`
- [ ] GET /api/owner/settings - `getTenantSettings(ctx.supabase, ctx.user.tenantId)`
- [ ] POST /api/owner/settings - `updateTenantSettings(ctx.supabase, ctx.user.tenantId, ...)`

**Manager Routes:**
- [ ] GET /api/manager/schedule - `getTeamSchedule(ctx.supabase, ctx.user.tenantId, ...)`
- [ ] POST /api/manager/schedule - `createScheduleOverride(ctx.supabase, ctx.user.tenantId, ...)`
- [ ] GET /api/manager/team - `getTeamData(ctx.supabase, ctx.user.tenantId)`
- [ ] POST /api/manager/team - `inviteTeamMember(ctx.supabase, ctx.user.tenantId, ...)`

### Tier 3 (Lower Priority - Specialized Features)
These can be fixed after core dashboard functionality is working:

**ML/Predictions:**
- [ ] POST /api/ml/predictions - Multiple calls use `ctx.user.tenantId`

**Module Management:**
- [ ] GET /api/modules - `VerticalModuleManager(ctx.user.tenantId)`
- [ ] POST /api/modules - `VerticalModuleManager(ctx.user.tenantId)`

**Product Recommendations:**
- [ ] POST /api/products/recommendations - Uses `ctx.user.tenantId`

**Other Specialized:**
- [ ] GET /api/scheduler/find-free-slot - Tenant validation
- [ ] GET /api/scheduler/find-free-staff - Tenant validation
- [ ] GET /api/scheduler/next-available - Tenant validation
- [ ] GET /api/admin/reservation-logs - Already has: `queryTenantId || ctx.user.tenantId`
- [ ] GET /api/bookings/products - `tenantId = ctx.user!.tenantId`

## Fix Pattern to Apply

Replace all instances of `ctx.user!.tenantId` with:

```typescript
const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

if (!tenantId) {
  throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
}

// Now use tenantId in queries instead of ctx.user!.tenantId
.eq('tenant_id', tenantId)
```

## Frontend Changes Required

Components calling dashboard APIs must use `authFetch()`:

```typescript
// WRONG - No auth header:
await fetch('/api/services')

// RIGHT - Includes auth + tenant headers:
import { authFetch } from '@/lib/auth/auth-api-client';
await authFetch('/api/services')
```

**Already Fixed:**
✅ ReservationsList component

**May Need Checking:**
- Any other components in /dashboard that call APIs
- Use `grep -r "fetch(" src/` and look for `/api/` calls

## Expected Outcome

After all fixes are applied:
1. No more `ctx.user!.tenantId is undefined` 500 errors
2. All API calls include `X-Tenant-ID` header automatically from authFetch
3. Tenant isolation enforced at database query level
4. Complete end-to-end auth flow working

## Staff Management Status ✅

**Good News:** Staff management routes ARE properly implemented:
- ✅ GET /api/owner/staff - Protected with `roles: ['owner']`
- ✅ POST /api/owner/staff - Supports invite/update/remove actions
- ✅ GET /api/manager/team - Protected with `roles: ['manager', 'owner']`
- ✅ POST /api/manager/team - Supports invite/role update/status management
- ✅ GET /api/dashboard/staff - Already exists and functional

**What Owners Can Do:**
- Invite staff members by email
- Assign roles (owner, manager, staff)
- View staff list with metrics
- Remove staff members
- Manage staff roles and permissions

**What Managers Can Do:**
- Invite team members (inherits from owner permissions)
- Update team member roles
- Set team member active/inactive status
- View team data and performance

## Testing Checklist

- [ ] /api/services returns 200 (not 500)
- [ ] /api/customers returns 200
- [ ] /api/reservations returns 200 with Authorization header present
- [ ] /dashboard/owner/staff shows staff management UI
- [ ] Owner can invite staff via modal
- [ ] Owner can view staff list
- [ ] Dashboard analytics load without 500 errors
- [ ] All API responses include correct tenant_id filtering
