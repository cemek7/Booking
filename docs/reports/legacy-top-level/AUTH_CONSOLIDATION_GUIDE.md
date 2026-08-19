# Authentication Consolidation Guide

**Status**: Phase 6 Complete - Unified Authentication System Ready  
**Reference**: TASK6_AUTH_CONSOLIDATION_ANALYSIS.md  

## Overview

The authentication system has been consolidated from 8 separate files into a unified orchestrator pattern. All routes now use consistent auth logic with centralized role and permission management.

## Key Components

### 1. UnifiedAuthOrchestrator (`src/lib/auth/unified-auth-orchestrator.ts`)

Single source of truth for all authentication operations.

**Key Methods**:
- `resolveSession(request)` - Extract and validate user from Bearer token
- `validateRole(user, requiredRoles)` - Check role access with inheritance
- `validatePermission(user, permission)` - Check specific permission
- `validateTenantAccess(user, tenantId)` - Verify tenant isolation
- `getEffectiveRoles(role)` - Get role hierarchy
- `getPermissionsForRole(role)` - Get role's permissions

**Usage in Route Handlers**:
```typescript
import { UnifiedAuthOrchestrator } from '@/lib/auth/unified-auth-orchestrator';

const orchestrator = UnifiedAuthOrchestrator.getInstance();
const user = await orchestrator.resolveSession(request);

if (!orchestrator.validateRole(user, ['owner', 'manager'])) {
  throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
}
```

### 2. PermissionsMatrix (`src/lib/auth/permissions-matrix.ts`)

Centralized permission definitions for all roles.

**Available Functions**:
- `hasPermission(role, resource, action)` - Check single permission
- `hasAnyPermission(role, resource, actions)` - Check any of multiple
- `hasAllPermissions(role, resource, actions)` - Check all permissions
- `getPermissionsForRole(role)` - Get all role permissions
- `getAccessibleResources(role, action)` - Get what resources role can access
- `canActOnRole(actingRole, targetRole)` - Check if one role can manage another

**Usage**:
```typescript
import { hasPermission, getAccessibleResources } from '@/lib/auth/permissions-matrix';

if (!hasPermission(user.role, 'staff', 'write')) {
  throw ApiErrorFactory.insufficientPermissions(['manager', 'owner']);
}

// Get all resources user can read
const readableResources = getAccessibleResources(user.role, 'read');
```

### 3. Server Auth (`src/lib/auth/server-auth.ts`)

Backward-compatible server-side auth functions for server components.

```typescript
import { requireAuth, requireOwnerAccess, hasPermission } from '@/lib/auth/server-auth';

// In server components:
const user = await requireOwnerAccess();

// Check permission
if (!hasPermission(user, 'staff', 'write')) {
  return <Unauthorized />;
}
```

### 4. Middleware (`src/lib/auth/middleware.ts`)

Server-side middleware for route protection.

```typescript
import { validateDashboardAccess } from '@/lib/auth/middleware';

const result = await validateDashboardAccess(request, 'owner');
if (!result.success) {
  return redirect(result.redirect);
}

const { user, tenant } = result.context;
```

## Migration Patterns

### Pattern 1: Use with createHttpHandler (Recommended)

```typescript
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.user is automatically available and verified
    // ctx.supabase is automatically initialized
    
    const { data, error } = await ctx.supabase
      .from('table')
      .select('*')
      .eq('tenant_id', ctx.user.tenantId);
    
    if (error) throw ApiErrorFactory.databaseError(error);
    return data;
  },
  'GET',
  { 
    auth: true,
    roles: ['owner', 'manager'] // Automatic role validation
  }
);
```

### Pattern 2: Manual Auth Resolution

```typescript
import { UnifiedAuthOrchestrator } from '@/lib/auth/unified-auth-orchestrator';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

export async function GET(request: NextRequest) {
  try {
    const orchestrator = UnifiedAuthOrchestrator.getInstance();
    
    // Resolve user from request
    const user = await orchestrator.resolveSession(request);
    
    // Validate role
    if (!orchestrator.validateRole(user, ['owner'])) {
      throw ApiErrorFactory.insufficientPermissions(['owner']);
    }
    
    // Your business logic here
    return NextResponse.json({ success: true });
    
  } catch (error) {
    if (error.code) {
      // Already an ApiError
      return NextResponse.json(
        { error: error.error, code: error.code, message: error.message },
        { status: error.statusCode }
      );
    }
    
    throw error;
  }
}
```

### Pattern 3: Permission-Based Access

```typescript
import { hasPermission } from '@/lib/auth/permissions-matrix';

export const PATCH = createHttpHandler(
  async (ctx) => {
    // Check specific resource:action permission
    if (!hasPermission(ctx.user.role, 'services', 'write')) {
      throw ApiErrorFactory.insufficientPermissions(['manager', 'owner']);
    }
    
    // Proceed with update
    return await updateService(ctx);
  },
  'PATCH',
  { auth: true }
);
```

## Role Hierarchy

Roles are automatically inherited in hierarchical order:

```
superadmin  (all permissions)
  ↓
owner       (full tenant control)
  ↓
manager     (operations management)
  ↓
staff       (schedule management)
  ↓
customer    (booking management)
  ↓
guest       (read-only)
```

When checking `validateRole(user, ['manager'])`, a user with 'owner' role will automatically pass because owner inherits manager.

## Permission Matrix

All permissions are defined in `permissions-matrix.ts`:

```typescript
PERMISSIONS_MATRIX = {
  owner: {
    'staff': ['read', 'write', 'delete', 'manage'],
    'services': ['read', 'write', 'delete', 'create'],
    'reservations': ['read', 'write', 'delete', 'manage'],
    // ... more resources
  },
  manager: {
    'staff': ['read', 'write', 'manage'],
    'services': ['read', 'write', 'manage'],
    // ... different permissions than owner
  },
  // ... other roles
}
```

To add new permissions:
1. Edit PERMISSIONS_MATRIX in `src/lib/auth/permissions-matrix.ts`
2. Use in code: `hasPermission(user.role, 'new_resource', 'new_action')`
3. No route changes needed

## Tenant Isolation

All auth checks automatically validate tenant boundaries:

```typescript
export const GET = createHttpHandler(
  async (ctx) => {
    // ctx.user.tenantId is verified from JWT
    // Orchestrator ensures user belongs to this tenant
    
    const { data } = await ctx.supabase
      .from('services')
      .select('*')
      .eq('tenant_id', ctx.user.tenantId); // Automatic isolation
    
    return data;
  },
  'GET',
  { auth: true }
);
```

## Common Scenarios

### Verify User Can Edit Another User's Profile

```typescript
import { canActOnRole } from '@/lib/auth/permissions-matrix';

export const PATCH = createHttpHandler(
  async (ctx) => {
    const { userId } = ctx.params;
    const targetUser = await getUser(userId);
    
    // Check if current user can act on target user's role
    if (!canActOnRole(ctx.user.role, targetUser.role)) {
      throw ApiErrorFactory.insufficientPermissions([]);
    }
    
    // Proceed with update
  },
  'PATCH',
  { auth: true }
);
```

### Get List of Accessible Resources

```typescript
import { getAccessibleResources } from '@/lib/auth/permissions-matrix';

export const GET = createHttpHandler(
  async (ctx) => {
    // Get all resources user can write to
    const writableResources = getAccessibleResources(ctx.user.role, 'write');
    
    return {
      resources: writableResources,
      totalCount: writableResources.length
    };
  },
  'GET',
  { auth: true }
);
```

### Superadmin Impersonation

```typescript
export const POST = createHttpHandler(
  async (ctx) => {
    if (ctx.user.role !== 'superadmin') {
      throw ApiErrorFactory.insufficientPermissions(['superadmin']);
    }
    
    const { targetUserId, targetTenantId } = await parseJsonBody(ctx.request);
    
    // Superadmin can act as any user
    const targetUser = await getUser(targetUserId);
    
    // Perform operation as if we're the target user
    return await performAction(targetUser, targetTenantId);
  },
  'POST',
  { auth: true }
);
```

## Error Handling

All auth errors are automatically transformed to consistent format:

```typescript
{
  "error": "insufficient_permissions",
  "code": "insufficient_permissions",
  "message": "User role insufficient to access this resource. Required roles: owner, manager",
  "details": {
    "requiredRoles": ["owner", "manager"],
    "userRole": "staff"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

Status codes are automatically set:
- **401**: missing_authorization, invalid_token, token_expired
- **403**: forbidden, insufficient_permissions, tenant_mismatch
- **500**: database_error, internal_server_error

## Testing

### Test Role Hierarchy

```typescript
import { UnifiedAuthOrchestrator } from '@/lib/auth/unified-auth-orchestrator';

const orchestrator = UnifiedAuthOrchestrator.getInstance();

// Owner should have manager permissions
expect(
  orchestrator.validateRole({ role: 'owner' }, ['manager'])
).toBe(true);
```

### Test Permissions

```typescript
import { hasPermission } from '@/lib/auth/permissions-matrix';

// Manager should be able to write to staff
expect(
  hasPermission('manager', 'staff', 'write')
).toBe(true);

// Staff should NOT be able to delete services
expect(
  hasPermission('staff', 'services', 'delete')
).toBe(false);
```

## Migration Checklist

When migrating a route to use unified auth:

- [ ] Remove manual Bearer token extraction
- [ ] Remove manual role checking logic
- [ ] Use `createHttpHandler()` with `roles` option, OR
- [ ] Use orchestrator.resolveSession() + validateRole()
- [ ] Use ApiErrorFactory for all error responses
- [ ] Test with valid and invalid tokens
- [ ] Test with different role combinations
- [ ] Verify error response format matches standard
- [ ] Check tenant isolation is working
- [ ] Verify performance (should be faster with caching)

## Troubleshooting

### "User not associated with any tenant"

**Cause**: User doesn't have a `tenant_users` entry  
**Fix**: Ensure user is invited to tenant first

```typescript
// Create tenant_users entry
await supabase.from('tenant_users').insert({
  user_id: userId,
  tenant_id: tenantId,
  role: 'staff'
});
```

### "Token expired" even with valid token

**Cause**: Token verification failing in Supabase  
**Fix**: Ensure Authorization header format is `Bearer <token>`

```typescript
// Correct
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

// Wrong
Authorization: eyJhbGciOiJIUzI1NiIs...
```

### Role inheritance not working

**Cause**: Passed array order matters for some checks  
**Fix**: Use orchestrator.validateRole() instead of manual array checks

```typescript
// Wrong - direct array check doesn't handle inheritance
if (['manager'].includes(user.role)) { } 

// Right - automatically handles inheritance
if (orchestrator.validateRole(user, ['manager'])) { }
```

## Performance Notes

- Role hierarchy is cached in memory
- Permission matrix is cached in memory
- Typical auth resolution: < 50ms for token validation + tenant check
- Caching eliminates repeated database lookups per request

## Next Steps

1. All 57+ API routes should now be migrated to use this system
2. See [BULK_MIGRATION_PLAN.md](BULK_MIGRATION_PLAN.md) for route migration order
3. See [API_MIGRATION_GUIDE.md](API_MIGRATION_GUIDE.md) for detailed examples

## Support

For questions or issues:
1. Check this guide first
2. Review example migration in `src/app/api/services/route.MIGRATED.ts`
3. Check test suite in `src/__tests__/unified-system.test.ts`
