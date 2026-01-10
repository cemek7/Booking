# Logical Incompatibilities & Security Fixes Implementation Plan

**Date:** November 25, 2025  
**Status:** Planning Phase  
**Priority:** Critical Security & Logic Issues  

## Executive Summary

This document outlines the implementation plan to fix critical logical incompatibilities, security gaps, and redundancies discovered in the Booka booking system. The issues span role management, permission systems, tenant isolation, and database security.

## Critical Issues Identified

### 🔴 **Priority 1: Security Vulnerabilities**
1. **Tenant Data Leakage** - Cross-tenant data access possible
2. **RLS Policy Gaps** - Many tables have ineffective row-level security
3. **Permission System Conflicts** - Dual systems create security holes
4. **Superadmin Audit Gap** - No tracking of privileged actions

### 🟡 **Priority 2: System Logic Issues**
5. **Role Definition Inconsistencies** - Multiple conflicting role types
6. **Permission Inheritance Broken** - Hierarchy not enforced
7. **Database Schema Misalignment** - Code and DB don't match
8. **Type Safety Gaps** - Loose typing allows invalid states

### 🟢 **Priority 3: Code Quality Issues**
9. **System Redundancies** - Duplicate permission functions
10. **Unused Code** - Dead interfaces and unused logic

---

## Implementation Plan

## Phase 1: Critical Security Fixes (Week 1)

### 1.1 Fix Tenant Isolation Vulnerability
**Files Affected:**
- `src/app/api/**/*.ts` (All API routes)
- `supabase/migrations/029_fix_rls_policies.sql` (New)
- `src/lib/rbac.ts`

**Current Issue:**
```typescript
// BAD: No tenant validation
const allowedTenant = !!tenantRole && ['admin', 'owner'].includes(tenantRole || '');

// BAD: RLS policy allows everything
CREATE POLICY users_select ON users FOR SELECT USING (true);
```

**Fix Implementation:**
```typescript
// GOOD: Proper tenant validation
const allowedTenant = await validateTenantAccess(userId, tenantId, ['owner', 'manager']);

// GOOD: Tenant-scoped RLS
CREATE POLICY users_tenant_select ON users 
FOR SELECT USING (
  tenant_id::text = current_setting('request.jwt.claims.tenant_id', true) OR
  auth.uid()::text IN (SELECT user_id FROM admins)
);
```

**Implementation Steps:**
1. Create `validateTenantAccess()` helper function
2. Replace all hardcoded role checks with tenant validation
3. Update RLS policies for proper tenant scoping
4. Add superadmin bypass for cross-tenant access

### 1.2 Consolidate Permission Systems
**Files Affected:**
- `src/types/permissions.ts` (Keep this one)
- `src/lib/rolePermissions.ts` (Refactor)
- `src/types/roles.ts` (Update)

**Current Issue:**
```typescript
// CONFLICT: Two different systems
// System 1: rolePermissions.ts
export function hasPermission(role: Role, resource: string, action: string): boolean

// System 2: permissions.ts  
export function hasPermission(userRole: UserRole, permissionId: string): PermissionCheckResult
```

**Fix Implementation:**
```typescript
// UNIFIED: Single permission system
export interface UnifiedPermissionCheck {
  hasPermission(
    userRole: UserRole, 
    resource: string, 
    action: PermissionAction, 
    context: PermissionContext
  ): PermissionCheckResult;
}
```

**Implementation Steps:**
1. Keep `src/types/permissions.ts` as the single source of truth
2. Migrate all logic from `src/lib/rolePermissions.ts` 
3. Update all imports across the codebase
4. Remove duplicate functions and types

### 1.3 Standardize Role Definitions
**Files Affected:**
- `src/types/roles.ts`
- `supabase/migrations/030_role_constraints.sql` (New)
- All API routes

**Current Issue:**
```typescript
// INCONSISTENT: Multiple role definitions
type Role = 'staff' | 'manager' | 'owner' | 'superadmin';
type UserRole = 'superadmin' | 'owner' | 'manager' | 'staff';
// API uses: ['admin', 'owner', 'tenant_admin', 'manager', 'staff', 'receptionist']
```

**Fix Implementation:**
```typescript
// STANDARDIZED: Single role system
export type UserRole = 'superadmin' | 'owner' | 'manager' | 'staff';
export type LegacyRoleMapping = {
  'admin': 'superadmin';
  'tenant_admin': 'owner'; 
  'receptionist': 'staff';
};
```

**Implementation Steps:**
1. Define canonical role types in `src/types/roles.ts`
2. Create role migration mapping for existing data
3. Add database constraint to enforce valid roles
4. Update all API endpoints to use standard roles
5. Create backward compatibility layer for legacy roles

## Phase 2: Database Security Enhancement (Week 2)

### 2.1 Implement Proper RLS Policies
**Files Affected:**
- `supabase/migrations/029_fix_rls_policies.sql` (New)
- `src/lib/supabase-rls.ts` (New helper)

**Current Issue:**
```sql
-- BAD: No actual security
CREATE POLICY tenant_users_select ON tenant_users FOR SELECT USING (true);
```

**Fix Implementation:**
```sql
-- GOOD: Tenant-scoped security
CREATE POLICY tenant_users_tenant_select ON tenant_users 
FOR SELECT TO authenticated
USING (
  -- Users can see their own tenant memberships
  tenant_id::text = current_setting('request.jwt.claims.tenant_id', true) OR
  -- Superadmins can see all
  auth.uid()::text IN (SELECT user_id FROM admins) OR
  -- Users can see their own records across tenants
  user_id = auth.uid()
);
```

**Implementation Steps:**
1. Audit all tables for proper tenant_id columns
2. Create tenant-scoped RLS policies for each table
3. Add superadmin bypass policies
4. Test policy enforcement with different user roles

### 2.2 Add Database Role Constraints
**Files Affected:**
- `supabase/migrations/030_role_constraints.sql` (New)

**Current Issue:**
```sql
-- BAD: Any string allowed
role text
```

**Fix Implementation:**
```sql
-- GOOD: Enforced valid roles
role text CHECK (role IN ('superadmin', 'owner', 'manager', 'staff'))
```

**Implementation Steps:**
1. Add check constraints for role columns
2. Create role enum type for consistency
3. Add data migration for invalid existing roles
4. Update application to handle constraint violations

## Phase 3: Permission System Overhaul (Week 3)

### 3.1 Implement Permission Inheritance
**Files Affected:**
- `src/lib/permission-engine.ts` (New)
- `src/types/permissions.ts`

**Current Issue:**
```typescript
// BAD: No inheritance logic
owner: { inherits: ['manager', 'staff'] } // Defined but not used
```

**Fix Implementation:**
```typescript
// GOOD: Working inheritance
export function getInheritedPermissions(role: UserRole): Permission[] {
  const roleHierarchy = {
    superadmin: ['owner', 'manager', 'staff'],
    owner: ['manager', 'staff'],
    manager: ['staff'],
    staff: []
  };
  
  return roleHierarchy[role].reduce((perms, inheritedRole) => {
    return [...perms, ...getDirectPermissions(inheritedRole)];
  }, getDirectPermissions(role));
}
```

**Implementation Steps:**
1. Create permission inheritance engine
2. Update hasPermission() to check inherited permissions
3. Add tests for permission inheritance scenarios
4. Document permission hierarchy clearly

### 3.2 Create Centralized Permission Checker
**Files Affected:**
- `src/lib/permission-checker.ts` (New)
- `src/middleware/auth-middleware.ts` (New)

**Current Issue:**
```typescript
// BAD: Scattered permission checks
// Different logic in every component/API
```

**Fix Implementation:**
```typescript
// GOOD: Centralized permission checking
export class PermissionChecker {
  async checkPermission(
    userId: string,
    tenantId: string, 
    resource: string,
    action: PermissionAction,
    context?: any
  ): Promise<PermissionCheckResult> {
    // 1. Get user role in tenant
    // 2. Check direct permissions
    // 3. Check inherited permissions  
    // 4. Apply contextual restrictions
    // 5. Log access attempt
  }
}
```

**Implementation Steps:**
1. Create centralized PermissionChecker class
2. Implement context-aware permission checking
3. Add audit logging for permission checks
4. Create middleware for API route protection
5. Refactor all existing permission checks

## Phase 4: API Security Hardening (Week 4)

### 4.1 Secure All API Routes
**Files Affected:**
- `src/middleware/tenant-auth.ts` (New)
- All API routes in `src/app/api/`
- All page API routes in `src/pages/api/`

**Current Issue:**
```typescript
// BAD: Inconsistent authorization
export default async function handler(req, res) {
  // Some check roles, some don't
  // Some check tenant membership, some don't
  // Inconsistent patterns everywhere
}
```

**Fix Implementation:**
```typescript
// GOOD: Consistent middleware pattern
export const withTenantAuth = (roles: UserRole[]) => (handler) => {
  return async (req, res) => {
    const { userId, tenantId, userRole } = await validateRequest(req);
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    const hasAccess = await PermissionChecker.checkTenantAccess(userId, tenantId);
    if (!hasAccess && userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Tenant access denied' });
    }
    
    req.user = { userId, tenantId, userRole };
    return handler(req, res);
  };
};
```

**Implementation Steps:**
1. Create tenant authentication middleware
2. Create permission checking middleware  
3. Apply middleware to all protected routes
4. Remove duplicate authorization code
5. Add consistent error handling

### 4.2 Implement Superadmin Audit Trail
**Files Affected:**
- `supabase/migrations/031_superadmin_audit.sql` (New)
- `src/lib/audit-logger.ts` (New)

**Current Issue:**
```typescript
// BAD: No superadmin tracking
if (isSuperAdmin) {
  // Can do anything, no logging
}
```

**Fix Implementation:**
```sql
-- GOOD: Superadmin audit table
CREATE TABLE superadmin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  action text NOT NULL,
  target_tenant_id uuid,
  target_user_id uuid,
  target_resource text,
  request_details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);
```

**Implementation Steps:**
1. Create superadmin audit log table
2. Implement audit logging service
3. Add logging to all superadmin actions
4. Create audit log viewing interface
5. Set up audit log retention policies

## Phase 5: Code Quality & Type Safety (Week 5)

### 5.1 Fix Type Safety Issues
**Files Affected:**
- `src/types/` (All type files)
- TypeScript config files

**Current Issue:**
```typescript
// BAD: Loose typing
const role: any = user.role;
const settings = (tenant?.settings || {}) as any;
```

**Fix Implementation:**
```typescript
// GOOD: Strict typing
export function isValidUserRole(role: string): role is UserRole {
  return ['superadmin', 'owner', 'manager', 'staff'].includes(role);
}

export interface TenantSettings {
  allowInvites?: boolean;
  maxUsers?: number;
  features?: string[];
}
```

**Implementation Steps:**
1. Add runtime type validation functions
2. Replace all `any` types with proper interfaces
3. Add strict TypeScript configuration
4. Create type guards for external data
5. Add runtime validation at API boundaries

### 5.2 Remove Code Redundancies
**Files Affected:**
- `src/lib/rolePermissions.ts` (Remove duplicate functions)
- `src/types/` (Clean up unused interfaces)

**Current Issue:**
```typescript
// BAD: Duplicate functions
function hasPermission() {} // In lib/rolePermissions.ts
function hasPermission() {} // In types/permissions.ts
```

**Fix Implementation:**
- Remove duplicate functions after consolidation
- Delete unused interfaces and types
- Consolidate similar utility functions
- Update all imports to use single source

## Testing & Validation Plan

### Security Testing
1. **Tenant Isolation Tests**
   - Verify users cannot access other tenants' data
   - Test superadmin cross-tenant access
   - Validate RLS policy enforcement

2. **Permission System Tests**
   - Test permission inheritance correctly
   - Verify role-based access control
   - Test edge cases and permission combinations

3. **API Security Tests**
   - Test unauthorized access attempts
   - Verify middleware protection
   - Test malformed requests and edge cases

### Integration Testing
1. **Database Migration Tests**
   - Test migration rollback scenarios
   - Verify data integrity after migrations
   - Test constraint enforcement

2. **End-to-End Tests**
   - Test complete user workflows
   - Verify multi-tenant scenarios
   - Test role transitions and updates

## Risk Management

### Migration Risks
- **Data Loss Risk**: Medium - Multiple schema changes
- **Downtime Risk**: Low - Migrations can run without downtime
- **Breaking Changes**: High - Permission system changes affect all features

### Mitigation Strategies
1. **Database Backups**: Full backup before each migration
2. **Gradual Rollout**: Deploy to staging first, then production
3. **Feature Flags**: Use flags to control new permission system activation
4. **Rollback Plan**: Prepare rollback scripts for each migration

## Success Metrics

### Security Metrics
- [ ] Zero cross-tenant data leakage incidents
- [ ] All API routes properly protected
- [ ] All superadmin actions logged
- [ ] RLS policies enforce tenant isolation

### Code Quality Metrics  
- [ ] Zero `any` types in role/permission code
- [ ] Single permission checking system
- [ ] Consistent role definitions across codebase
- [ ] 100% test coverage for permission logic

## Implementation Timeline

| Phase | Duration | Key Deliverables | Success Criteria |
|-------|----------|------------------|------------------|
| Phase 1 | Week 1 | Critical security fixes | No tenant data leakage possible |
| Phase 2 | Week 2 | Database security | All RLS policies enforced |
| Phase 3 | Week 3 | Permission system | Single working permission system |
| Phase 4 | Week 4 | API hardening | All routes consistently protected |
| Phase 5 | Week 5 | Code quality | Type-safe, clean codebase |

## Next Steps

1. **Review this plan** and provide feedback on priorities and approach
2. **Approve migration strategy** and risk mitigation plans  
3. **Begin Phase 1 implementation** starting with the most critical security fixes
4. **Set up monitoring** for tracking progress and catching issues early

---

**Note**: This plan addresses fundamental architectural issues that affect security and data integrity. While comprehensive, it's essential for system reliability and cannot be safely postponed.

**Author**: GitHub Copilot Analysis  
**Last Updated**: November 25, 2025  
**Status**: Awaiting Review & Approval