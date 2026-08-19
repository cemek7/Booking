# API Route Migration Priority List

**Status**: Ready for bulk conversion  
**Target**: Convert all 57+ API routes to unified error handling and auth  
**Timeline**: 4-6 hours for 20 critical routes, then remaining batch  
**Tools Available**:
- `createHttpHandler()` - Wrapper for single HTTP methods
- `createApiHandler()` - Full-featured handler with method checking
- `ApiErrorFactory` - Standardized error creation
- Migration helpers: `getTenantId()`, `getResourceId()`, `executeDb()`, etc.
- Template: `API_ROUTE_TEMPLATE.ts`
- Example: `src/app/api/services/route.MIGRATED.ts`

---

## Priority 1: Core Endpoints (High Impact) - 8 routes
Convert these first as they are most frequently used

| File | Current Lines | Est. Converted | Impact | Status |
|------|---------------|-----------------|--------|--------|
| `src/app/api/services/route.ts` | 362 | 260 | Core CRUD | Migrated example |
| `src/app/api/staff/route.ts` | ~300 | ~220 | Staff management | Ready |
| `src/app/api/tenants/[id]/settings/route.ts` | ~250 | ~180 | Tenant config | Ready |
| `src/app/api/reservations/[id]/route.ts` | ~350 | ~260 | Booking system | Ready |
| `src/app/api/superadmin/dashboard/route.ts` | ~180 | ~140 | Admin panel | Ready |
| `src/app/api/auth/enhanced/mfa/route.ts` | ~400 | ~300 | Auth critical | Ready |
| `src/app/api/payments/stripe/route.ts` | ~320 | ~240 | Payments | Ready |
| `src/app/api/user/tenant/route.ts` | ~200 | ~150 | User context | Ready |

**Total P1**: 2,352 lines → ~1,750 lines (25% reduction)  
**Effort**: 2-3 hours  
**Benefits**: Core system fully modernized

---

## Priority 2: Supporting Endpoints (Medium Impact) - 12 routes
Convert after Priority 1 as they support core features

| File | Current Lines | Est. Converted | Impact | Status |
|------|---------------|-----------------|--------|--------|
| `src/app/api/tenants/[id]/staff/route.ts` | ~280 | ~200 | Tenant staff | Ready |
| `src/app/api/tenants/[id]/services/route.ts` | ~280 | ~200 | Tenant services | Ready |
| `src/app/api/tenants/[id]/invites/route.ts` | ~220 | ~160 | Invitations | Ready |
| `src/app/api/tenants/[id]/apikey/route.ts` | ~200 | ~150 | API keys | Ready |
| `src/app/api/staff/[id]/status/route.ts` | ~150 | ~120 | Staff status | Ready |
| `src/app/api/staff/[id]/attributes/route.ts` | ~200 | ~150 | Staff attributes | Ready |
| `src/app/api/staff-skills/route.ts` | ~150 | ~120 | Staff skills | Ready |
| `src/app/api/staff-skills/[user_id]/[skill_id]/route.ts` | ~120 | ~100 | Skill mapping | Ready |
| `src/app/api/skills/route.ts` | 83 | 70 | Skills | Ready |
| `src/app/api/skills/[id]/route.ts` | ~100 | ~80 | Skill detail | Ready |
| `src/app/api/tenant-users/[userId]/role/route.ts` | ~180 | ~140 | User roles | Ready |
| `src/app/api/staff/metrics/route.ts` | ~200 | ~160 | Metrics | Ready |

**Total P2**: 2,263 lines → ~1,630 lines (27% reduction)  
**Effort**: 2-3 hours  
**Dependencies**: P1 complete

---

## Priority 3: Scheduler/Advanced Features (Medium Impact) - 5 routes
These handle complex business logic but fewer requests

| File | Current Lines | Est. Converted | Impact | Status |
|------|---------------|-----------------|--------|--------|
| `src/app/api/scheduler/find-free-slot/route.ts` | ~300 | ~220 | Scheduling | Ready |
| `src/app/api/scheduler/find-free-staff/route.ts` | ~280 | ~210 | Staff finding | Ready |
| `src/app/api/scheduler/next-available/route.ts` | ~200 | ~160 | Availability | Ready |
| `src/app/api/risk-management/route.ts` | ~250 | ~190 | Risk scoring | Ready |
| `src/app/api/security/evaluate/route.ts` | ~280 | ~210 | Security | Ready |

**Total P3**: 1,310 lines → ~990 lines (24% reduction)  
**Effort**: 1.5-2 hours  
**Dependencies**: P1 complete

---

## Priority 4: Webhooks & External Integrations (Lower Impact) - 10 routes
Process external events - fewer direct user interactions

| File | Current Lines | Est. Converted | Impact | Status |
|------|---------------|-----------------|--------|--------|
| `src/app/api/webhooks/evolution/route.ts` | ~350 | ~260 | WhatsApp integration | Ready |
| `src/app/api/whatsapp/webhook/route.ts` | ~300 | ~220 | WhatsApp messages | Ready |
| `src/app/api/payments/stripe/webhook/route.ts` | ~250 | ~190 | Stripe payments | Ready |
| `src/app/api/webhooks/.*` (6 more) | ~1,500 | ~1,100 | Various integrations | Ready |

**Total P4**: ~2,400 lines → ~1,770 lines (26% reduction)  
**Effort**: 2-3 hours  
**Note**: Some webhooks may not need auth - mark as `auth: false`

---

## Priority 5: Utility & Monitoring Endpoints (Low Impact) - 10+ routes
Monitoring, health checks, metrics - rarely called

| File | Current Lines | Est. Converted | Impact | Status |
|------|---------------|-----------------|--------|--------|
| `src/app/api/health/route.ts` | ~50 | ~40 | Health check | Ready |
| `src/app/api/metrics/route.ts` | ~150 | ~120 | Metrics | Ready |
| `src/app/api/usage/route.ts` | ~120 | ~100 | Usage | Ready |
| `src/app/api/security/pii/route.ts` | ~180 | ~140 | PII data | Ready |
| Others | ~500 | ~400 | Miscellaneous | Ready |

**Total P5**: ~1,000 lines → ~800 lines (20% reduction)  
**Effort**: 1-1.5 hours

---

## Migration Execution Plan

### Phase 1: Setup (30 minutes)
```bash
# Ensure infrastructure is ready
- ✅ ErrorFactory tests pass
- ✅ Migration helpers loaded
- ✅ Template available
```

### Phase 2: Convert Priority 1 (2-3 hours)
```bash
# 1. services/route.ts → Use MIGRATED.ts as guide
# 2. staff/route.ts → Copy template, customize
# 3. Convert remaining 6 P1 routes
# 4. Run tests after each 2-3 routes
# 5. Commit changes in batches
```

### Phase 3: Convert Priority 2 (2-3 hours)
```bash
# Build momentum with 12 supporting routes
# Most are similar patterns (GET, POST, PATCH, DELETE)
# Can template-driven conversion
```

### Phase 4: Convert Priorities 3-5 (4-5 hours)
```bash
# Handle complex logic (scheduler, webhooks)
# Process utility endpoints quickly
# Final commit: all 57+ routes modernized
```

### Phase 5: Integration Testing (1-2 hours)
```bash
# Run full test suite
# Spot check error responses
# Verify role-based access
# Performance comparison
```

---

## Migration Checklist Per Route

Copy this for each route being converted:

```markdown
### [ ] {Route Name} - src/app/api/{path}/route.ts

**Status**: Ready for conversion
**Current Lines**: X
**Est. Converted**: Y
**Complexity**: Simple/Medium/Complex

- [ ] Remove inline Bearer token extraction
- [ ] Remove manual user validation
- [ ] Remove manual role checking
- [ ] Replace try/catch blocks with ApiErrorFactory
- [ ] Update error responses to new format
- [ ] Use ctx.user instead of manual lookups
- [ ] Use ctx.supabase instead of getSupabaseRouteHandlerClient()
- [ ] Wrap with createHttpHandler() or createApiHandler()
- [ ] Test with curl/Postman
- [ ] Verify error codes and status codes
- [ ] Check role-based access control
- [ ] Commit changes
```

---

## Key Conversion Patterns

### GET Listing with Pagination
```typescript
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = await getTenantId(ctx);
    const { page, limit, offset } = getPaginationParams(ctx);
    
    const { data, error } = await ctx.supabase
      .from('table')
      .select('*')
      .eq('tenant_id', tenantId)
      .range(offset, offset + limit - 1);
    
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'GET',
  { auth: true }
);
```

### POST Creating Resource
```typescript
export const POST = createHttpHandler(
  async (ctx) => {
    const body = await parseJsonBody(ctx.request);
    
    if (!body.name?.trim()) {
      throw ApiErrorFactory.validationError({ name: 'Required' });
    }
    
    const { data, error } = await ctx.supabase
      .from('table')
      .insert({ ...body, tenant_id: ctx.user?.tenantId })
      .select()
      .single();
    
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### PATCH Updating Resource
```typescript
export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = await getResourceId(ctx);
    await verifyTenantOwnership(ctx, 'table', id);
    
    const body = await parseJsonBody(ctx.request);
    const { data, error } = await ctx.supabase
      .from('table')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### DELETE Removing Resource
```typescript
export const DELETE = createHttpHandler(
  async (ctx) => {
    const id = await getResourceId(ctx);
    
    if (ctx.user?.role !== 'owner') {
      throw ApiErrorFactory.insufficientPermissions(['owner']);
    }
    
    await verifyTenantOwnership(ctx, 'table', id);
    
    const { error } = await ctx.supabase
      .from('table')
      .delete()
      .eq('id', id);
    
    if (error) throw ApiErrorFactory.databaseError(error);
    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
```

---

## Estimated Impact

### Code Reduction
- **Before**: ~9,000 lines across 57 routes
- **After**: ~6,500 lines (28% reduction through abstraction)
- **Duplicated code eliminated**: 150+ Bearer extractions, 100+ error handlers, 50+ role checks

### Quality Improvements
- ✅ Unified error format across all endpoints
- ✅ Consistent status codes (401, 403, 404, 500, etc.)
- ✅ Centralized auth/permission logic
- ✅ Better type safety with RouteContext
- ✅ Easier to test and maintain
- ✅ Reduces bugs from copy-paste errors

### Timeline
- **Priority 1 (Core)**: 2-3 hours
- **Priority 2 (Supporting)**: 2-3 hours
- **Priority 3 (Advanced)**: 1.5-2 hours
- **Priority 4 (Webhooks)**: 2-3 hours
- **Priority 5 (Utility)**: 1-1.5 hours
- **Testing**: 1-2 hours
- **Total**: 10-15 hours spread over 2 days

---

## Rollback Plan

If issues arise:
1. Keep original files in git history
2. Can revert specific routes
3. Middleware orchestrator is backward compatible
4. Error handling works with both old and new code

All endpoints can coexist during transition period.
