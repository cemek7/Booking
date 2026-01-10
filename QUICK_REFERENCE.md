# Phase 2 Quick Reference Guide

**Use this when working on Phase 2 tasks**

---

## 📋 Current Phase Status

**Phase**: 2 (Medium Priority Technical Debt)  
**Progress**: 62.5% Complete (5/8 tasks)  
**Status**: ON TRACK  
**Estimated Completion**: 18-24 additional hours

---

## ✅ What's Complete

- [x] Unified Middleware Orchestrator (Task 2)
- [x] Consistent Error Handling (Task 4)
- [x] Migration Infrastructure (Task 5)
- [x] Auth Consolidation Plan (Task 6 - analysis only)
- [x] All documentation and guides

---

## 🟡 Currently Working On

- Task 6: Auth Consolidation (In Progress)
  - Status: Analysis complete, ready for implementation
  - Effort: 8-10 hours remaining
  - Next: Implement UnifiedAuthOrchestrator

---

## ⏳ Not Started Yet

- Task 7: Route Migration (Pending Task 6)
- Task 8: Integration Testing (Pending Tasks 6-7)

---

## 📚 Key Documentation Files

### Quick Start
- `API_MIGRATION_GUIDE.md` - How to migrate a single route (START HERE)
- `API_ROUTE_TEMPLATE.ts` - Copy-paste template

### Reference
- `BULK_MIGRATION_PLAN.md` - Priority list for all 57 routes
- `TASK6_AUTH_CONSOLIDATION_ANALYSIS.md` - Auth consolidation plan
- `PHASE2_FINAL_STATUS_REPORT.md` - Full project status

### Examples
- `src/app/api/services/route.MIGRATED.ts` - Working example endpoint

---

## 🛠️ Main Infrastructure Files

### Middleware System
```
src/middleware/unified/orchestrator.ts (480 lines)
src/middleware/unified/middleware-adapter.ts (320 lines)
src/middleware/unified/auth/auth-handler.ts (280 lines)
```

### Error Handling
```
src/lib/error-handling/api-error.ts (290 lines)
src/lib/error-handling/route-handler.ts (320 lines)
src/lib/error-handling/migration-helpers.ts (280 lines)
```

### Updated
```
src/middleware.ts (now uses orchestrator)
```

---

## 🚀 How to Use the System

### Create a New Unified Route
```typescript
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.user.id, ctx.user.role, ctx.supabase available
    // Use ApiErrorFactory for errors
    // Errors automatically transformed
    return { data: 'example' };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### Handle Errors
```typescript
// Use ApiErrorFactory
throw ApiErrorFactory.missingAuthorization();
throw ApiErrorFactory.insufficientPermissions(['owner']);
throw ApiErrorFactory.notFound('Service');
throw ApiErrorFactory.databaseError(error);
throw ApiErrorFactory.validationError({ field: 'error' });
```

### Helper Functions
```typescript
import { getTenantId, getResourceId, executeDb } from '@/lib/error-handling/migration-helpers';

// Get tenant ID from params/query/body/context
const tenantId = await getTenantId(ctx);

// Get resource ID
const id = await getResourceId(ctx);

// Execute database operation with error handling
const data = await executeDb(ctx, async (supabase) => {
  return supabase.from('table').select('*');
});
```

---

## 📊 Error Codes Available

**Authentication (401)**
- `MISSING_AUTHORIZATION` - No auth header
- `INVALID_TOKEN` - Invalid/malformed token
- `TOKEN_EXPIRED` - Token has expired

**Permission (403)**
- `FORBIDDEN` - Access denied
- `INSUFFICIENT_PERMISSIONS` - Missing required roles
- `TENANT_MISMATCH` - Wrong tenant

**Validation (400)**
- `VALIDATION_ERROR` - Failed validation
- `INVALID_REQUEST` - Bad request
- `MISSING_REQUIRED_FIELD` - Required field missing

**Not Found (404)**
- `NOT_FOUND` - Resource not found
- `RESOURCE_NOT_FOUND` - Specific resource missing

**Conflict (409)**
- `CONFLICT` - Resource conflict
- `DUPLICATE_RESOURCE` - Already exists

**Server (500+)**
- `DATABASE_ERROR` - DB operation failed
- `INTERNAL_SERVER_ERROR` - Unknown error
- `EXTERNAL_SERVICE_ERROR` - Third-party service failed
- `TIMEOUT` - Operation timed out

---

## 🎯 Task 6: Auth Consolidation (Current Focus)

### What to Do
1. Read `TASK6_AUTH_CONSOLIDATION_ANALYSIS.md`
2. Implement `UnifiedAuthOrchestrator` class
3. Create `PermissionsMatrix` system
4. Migrate existing auth code to use new system

### Phases (8-10 hours total)
- Phase 6.1: Design orchestrator (2-3h)
- Phase 6.2: Permissions matrix (2-3h)
- Phase 6.3: Migrate code (2-3h)
- Phase 6.4: Testing (1h)
- Phase 6.5: Documentation (1-2h)

### Key Design
```typescript
class UnifiedAuthOrchestrator {
  async resolveSession(request): Promise<UnifiedAuthContext>;
  validateRole(user, requiredRoles): boolean;
  validatePermission(user, permission): boolean;
  getEffectiveRoles(role): Role[];
  validateTenantAccess(user, tenantId): boolean;
}

const PERMISSIONS_MATRIX = {
  owner: { dashboard: ['view', 'edit', 'delete'], ... },
  manager: { ... },
  staff: { ... },
};
```

---

## 📝 Task 7: Route Migration (Next After Task 6)

### Priority Groups
| Group | Routes | Time |
|-------|--------|------|
| P1 | 8 core (services, staff, etc) | 2-3h |
| P2 | 12 supporting | 2-3h |
| P3 | 5 advanced (scheduler) | 1.5-2h |
| P4 | 10 webhooks | 2-3h |
| P5 | 22 utility | 1-1.5h |

### Conversion Steps
1. Copy `API_ROUTE_TEMPLATE.ts`
2. Update table name and methods
3. Wrap with `createHttpHandler()`
4. Replace error handling with `ApiErrorFactory`
5. Test with curl
6. Delete old version

---

## 🧪 Testing

### Integration Tests Located At
```
src/__tests__/unified-system.test.ts
```

### Run Tests
```bash
npm test -- unified-system.test.ts
```

### Test Coverage
- Middleware orchestrator ✅
- Error handling ✅
- Response formats ✅
- Error codes ✅

---

## 📦 Important Files to Know

| File | Purpose |
|------|---------|
| `src/middleware.ts` | Entry point for middleware |
| `src/middleware/unified/orchestrator.ts` | Middleware composition |
| `src/lib/error-handling/api-error.ts` | Error definitions |
| `src/lib/error-handling/route-handler.ts` | Handler wrappers |
| `API_MIGRATION_GUIDE.md` | Migration instructions |
| `API_ROUTE_TEMPLATE.ts` | Template for new routes |

---

## 💡 Common Patterns

### GET List (with pagination)
```typescript
export const GET = createHttpHandler(
  async (ctx) => {
    const { page, limit, offset } = getPaginationParams(ctx);
    const { data, error } = await ctx.supabase
      .from('table').select('*').range(offset, offset + limit - 1);
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'GET',
  { auth: true }
);
```

### POST Create
```typescript
export const POST = createHttpHandler(
  async (ctx) => {
    const body = await parseJsonBody(ctx.request);
    if (!body.name) throw ApiErrorFactory.validationError({ name: 'Required' });
    const { data, error } = await ctx.supabase
      .from('table').insert({ ...body, tenant_id: ctx.user?.tenantId }).select().single();
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### PATCH Update
```typescript
export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = await getResourceId(ctx);
    await verifyTenantOwnership(ctx, 'table', id);
    const body = await parseJsonBody(ctx.request);
    const { data, error } = await ctx.supabase
      .from('table').update(body).eq('id', id).select().single();
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
```

### DELETE Remove
```typescript
export const DELETE = createHttpHandler(
  async (ctx) => {
    const id = await getResourceId(ctx);
    if (ctx.user?.role !== 'owner') throw ApiErrorFactory.insufficientPermissions(['owner']);
    await verifyTenantOwnership(ctx, 'table', id);
    const { error } = await ctx.supabase.from('table').delete().eq('id', id);
    if (error) throw ApiErrorFactory.databaseError(error);
    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
```

---

## 🐛 Troubleshooting

### "User not found"
```typescript
// Make sure ctx.user is populated
// Check middleware registration in middleware-adapter.ts
```

### "Missing authorization"
```typescript
// Check Authorization header: "Bearer {token}"
// Verify token is valid
```

### "Insufficient permissions"
```typescript
// Check roles parameter in handler options
// Verify user role in database
```

### Type errors with RouteContext
```typescript
// Import: import { RouteContext } from '@/lib/error-handling/route-handler';
// Use in handler: async (ctx: RouteContext) => { ... }
```

---

## 📞 Quick Links

- **Migration Guide**: `API_MIGRATION_GUIDE.md`
- **Bulk Plan**: `BULK_MIGRATION_PLAN.md`
- **Auth Plan**: `TASK6_AUTH_CONSOLIDATION_ANALYSIS.md`
- **Status**: `PHASE2_FINAL_STATUS_REPORT.md`
- **Example**: `src/app/api/services/route.MIGRATED.ts`
- **Tests**: `src/__tests__/unified-system.test.ts`

---

## ✨ Next Steps

1. Read `TASK6_AUTH_CONSOLIDATION_ANALYSIS.md`
2. Implement Phase 6.1: UnifiedAuthOrchestrator
3. Create Phase 6.2: PermissionsMatrix
4. Migrate existing auth (Phase 6.3)
5. Begin Task 7: Route migrations

---

**Last Updated**: 2024-01-15  
**Current Task**: 6 (Auth Consolidation)  
**Status**: ON TRACK ✅
