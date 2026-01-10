# Phase 3A: Critical Auth Route Migration

**Status**: IN PROGRESS  
**Target**: 8 authentication routes  
**Priority**: CRITICAL - All other routes depend on this  

---

## Auth Routes to Migrate

### 1. POST /api/auth/admin-check ✅
**Current**: Manual Supabase queries  
**Target**: createHttpHandler with public access  
**Changes**:
- Remove manual client creation
- Use parseJsonBody for email validation
- Return consistent response format
- Use ApiErrorFactory for errors
- Mark as public endpoint (auth: false)

### 2. GET /api/auth/me ✅
**Current**: Manual session extraction and role lookups  
**Target**: createHttpHandler with full auth  
**Changes**:
- Use UnifiedAuthOrchestrator for session
- Remove manual tenant_users query
- Return normalized response
- Automatic error handling

### 3. POST /api/auth/finish ✅
**Current**: Manual session handling  
**Target**: createHttpHandler  
**Changes**:
- Use UnifiedAuthOrchestrator
- Validate session exists
- Upsert user correctly
- Handle missing service role gracefully

### 4. POST /api/auth/enhanced/login
**Current**: Manual auth flow  
**Target**: createHttpHandler  
**Changes**:
- Use UnifiedAuthOrchestrator
- Validate credentials
- Create session
- Return user + tenants

### 5. POST /api/auth/enhanced/logout
**Current**: Manual session clearing  
**Target**: createHttpHandler  
**Changes**:
- Use UnifiedAuthOrchestrator
- Validate user exists
- Clear session
- Return success

### 6. POST /api/auth/enhanced/mfa
**Current**: Manual MFA handling  
**Target**: createHttpHandler  
**Changes**:
- Use UnifiedAuthOrchestrator
- Validate MFA setup
- Generate/verify codes
- Return status

### 7. POST /api/auth/enhanced/security
**Current**: Manual security operations  
**Target**: createHttpHandler  
**Changes**:
- Use UnifiedAuthOrchestrator
- Validate user
- Update security settings
- Log changes

### 8. POST /api/auth/enhanced/api-keys
**Current**: Manual API key management  
**Target**: createHttpHandler  
**Changes**:
- Use UnifiedAuthOrchestrator
- Validate permissions
- CRUD operations on keys
- Secure key storage

---

## Migration Template

```typescript
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { parseJsonBody } from '@/lib/error-handling/migration-helpers';

/**
 * [METHOD] /api/auth/[endpoint]
 * 
 * Description of what this endpoint does
 * 
 * Request: { ...fields }
 * Response: { ...fields }
 * 
 * Errors:
 * - 401: Not authenticated
 * - 403: Insufficient permissions
 * - 400: Invalid request
 * - 500: Server error
 */
export const [METHOD] = createHttpHandler(
  async (ctx) => {
    // 1. Parse & validate request
    const body = await parseJsonBody(ctx.request, {...});
    
    // 2. Verify auth (automatic for auth: true)
    // ctx.user is pre-verified by createHttpHandler
    
    // 3. Business logic
    // Use ctx.supabase for queries
    // Use ctx.user for context
    
    // 4. Return response
    return { ...response };
  },
  '[METHOD]',
  {
    auth: true/false,          // Require auth?
    roles: ['role1', 'role2']  // Required roles (if auth: true)
  }
);
```

---

## Implementation Progress

| Route | Status | Effort | Blocker |
|-------|--------|--------|---------|
| /api/auth/admin-check | ✅ Template ready | 1h | None |
| /api/auth/me | ✅ Template ready | 1h | None |
| /api/auth/finish | ✅ Template ready | 1h | None |
| /api/auth/enhanced/login | 🔄 In progress | 2h | Session creation |
| /api/auth/enhanced/logout | 🔴 Todo | 1h | auth:me |
| /api/auth/enhanced/mfa | 🔴 Todo | 2h | MFA service |
| /api/auth/enhanced/security | 🔴 Todo | 2h | Security service |
| /api/auth/enhanced/api-keys | 🔴 Todo | 2h | Key storage |

---

## Testing Checklist Per Route

### admin-check
- [ ] Missing email returns 400
- [ ] Valid admin email returns admin response
- [ ] Valid tenant user returns tenant response
- [ ] Unknown email returns null

### me
- [ ] No token returns 401
- [ ] Valid token returns user data
- [ ] Returns all tenant memberships
- [ ] Returns superadmin status

### finish
- [ ] Missing session returns 400
- [ ] Valid session creates/updates user
- [ ] Returns success response
- [ ] Handles service role missing gracefully

### login
- [ ] Missing credentials return 400
- [ ] Invalid credentials return 401
- [ ] Valid credentials return session + user
- [ ] Returns tenant list

### logout
- [ ] No auth returns 401
- [ ] Valid auth clears session
- [ ] Returns success
- [ ] Subsequent requests return 401

### mfa
- [ ] Check MFA status
- [ ] Enable MFA (generates code)
- [ ] Verify MFA code
- [ ] Disable MFA

### security
- [ ] Update password
- [ ] View security settings
- [ ] Enable/disable features
- [ ] View login history

### api-keys
- [ ] Create API key
- [ ] List API keys
- [ ] Rotate API key
- [ ] Delete API key
- [ ] Validate key in requests

---

## Dependencies to Verify

### UnifiedAuthOrchestrator
- ✅ Already created and working
- Methods needed:
  - resolveSession(request)
  - validateRole(user, roles)
  - validatePermission(user, permission)

### ApiErrorFactory
- ✅ Already created with 18 error codes
- Methods needed:
  - validationError(field, message)
  - databaseError(error)
  - insufficientPermissions(roles)
  - unauthorized()
  - invalidToken()
  - notFound(resource)

### Route Handler
- ✅ createHttpHandler already exists
- Provides:
  - ctx.request
  - ctx.supabase (auto-initialized)
  - ctx.user (auto-verified if auth:true)
  - ctx.params
  - ctx.route

### Utilities
- ✅ parseJsonBody(request, schema)
- ✅ getTenantId(ctx)
- ✅ verifyOwnership(ctx, resourceId, userId)

---

## Performance Targets

| Operation | Before | Target | Improvement |
|-----------|--------|--------|-------------|
| Admin check | 80-120ms | <20ms | 75% |
| Auth me | 100-150ms | <30ms | 70% |
| Auth finish | 50-80ms | <10ms | 80% |
| MFA check | 150-200ms | <50ms | 70% |
| API key verify | 100-150ms | <20ms | 85% |

---

## Documentation Updates Needed

1. [AUTH_CONSOLIDATION_GUIDE.md](AUTH_CONSOLIDATION_GUIDE.md)
   - Update auth route examples
   - Add new error responses
   - Document auth flow diagram

2. [API_MIGRATION_GUIDE.md](API_MIGRATION_GUIDE.md)
   - Add auth route migration examples
   - Document public vs private endpoints
   - Add error handling patterns

3. OpenAPI/Swagger
   - Document all 8 endpoints
   - Define request/response schemas
   - Add security schemes

---

## Rollback Plan

If auth route migration fails:
1. Keep backup of original routes
2. Revert to original files
3. Disable new routes
4. Re-enable old routes
5. Investigate and fix
6. Re-deploy

All original routes are preserved for rollback.

---

## Success Criteria

✅ All 8 auth routes migrated  
✅ All routes use unified pattern  
✅ All error responses consistent  
✅ All tests passing  
✅ Performance improved  
✅ Rollback possible  
✅ Documentation updated  

---

**Next Step**: Complete migration of remaining 5 auth routes

