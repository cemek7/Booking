# 🚀 Quick Reference - Unified Permission System

## Common Patterns

### 🔐 API Protection Templates

#### Basic Authentication
```typescript
import { requireAuth, handleAuthResult } from '@/types/unified-auth';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // Business logic...
}
```

#### Manager-Level Access
```typescript
import { requireManagerAccess, handleAuthResult } from '@/types/unified-auth';

export async function POST(request: NextRequest) {
  const authResult = await requireManagerAccess(request);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // Manager operations...
}
```

#### Permission-Based Access
```typescript
import { requirePermission, handleAuthResult } from '@/types/unified-auth';

export async function PUT(request: NextRequest) {
  const authResult = await requirePermission(request, 'team:manage:all');
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // Team management...
}
```

#### Owner-Only Operations
```typescript
import { requireOwnerAccess, handleAuthResult } from '@/types/unified-auth';

export async function DELETE(request: NextRequest) {
  const authResult = await requireOwnerAccess(request);
  const authError = handleAuthResult(authResult);
  if (authError) return authError;
  
  const { user } = authResult;
  // Owner operations...
}
```

### 📋 Permission Quick Reference

| Operation | Permission | Role Requirement |
|-----------|------------|------------------|
| View own bookings | `booking:read:own` | Staff+ |
| View all bookings | `booking:read:all` | Manager+ |
| Create bookings | `booking:create:all` | Staff+ |
| Edit own bookings | `booking:edit:own` | Staff+ |
| Edit all bookings | `booking:edit:all` | Manager+ |
| Delete bookings | `booking:delete:all` | Manager+ |
| View team | `team:read:all` | Manager+ |
| Manage team | `team:manage:all` | Manager+ |
| View schedules | `schedule:read:all` | Manager+ |
| Edit schedules | `schedule:write:all` | Manager+ |
| View analytics | `analytics:read:all` | Manager+ |
| Export data | `analytics:export:all` | Owner+ |
| Tenant settings | `tenant:configure:all` | Owner+ |
| User management | `user:manage:all` | Owner+ |
| System admin | `system:manage:all` | SuperAdmin |

### 🏷️ Role Hierarchy

```
SuperAdmin → Owner → Manager → Staff
```

### 🧪 Testing Commands

```bash
# All permission tests
npm run test:permissions

# With coverage
npm run test:permissions:coverage

# Security tests only
npm run test:permissions:security

# Watch mode
npm run test:permissions:watch
```

### 📊 Audit Queries

```typescript
import { getAuditLogger } from '@/types/audit-logging';

// Recent violations
const violations = await auditLogger.queryAuditLogs({
  eventType: 'security_violation',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  limit: 50
});

// User activity
const userActivity = await auditLogger.queryAuditLogs({
  userId: 'user-123',
  startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
});
```

### 🔍 Debug Helpers

```typescript
// Check user permissions
const checker = getUnifiedChecker();
const hasAccess = await checker.hasPermission(userId, tenantId, 'permission');

// Detailed permission check
const result = await checker.checkAccess(userId, permission, context);
console.log('Access result:', result);
```

## Migration Checklist

- [ ] Replace `requireAuth()` calls
- [ ] Update permission checks
- [ ] Add audit logging  
- [ ] Run security tests
- [ ] Update documentation
- [ ] Enable monitoring