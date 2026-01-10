# Remaining Endpoints to Migrate - Phase 1.7 & 1.8

**Status**: 8 of 29 endpoints remaining (28%)
**Estimated Time**: 12 hours total (7 hours migration + 5 hours cleanup)

## Remaining Endpoints by Priority

### 🔴 CRITICAL - Must Migrate Before Production (3 endpoints)

#### 1. Payment Processing Endpoints
**Location**: `src/pages/api/payments/`
**Estimated Effort**: 2.5 hours
**Impact**: CRITICAL - Blocking payment functionality

**Sub-endpoints to investigate**:
- `payments/create.ts` - Create payment intent
- `payments/confirm.ts` - Confirm payment
- `payments/webhook.ts` - Payment provider webhooks (Stripe/Paystack)
- `payments/refund.ts` - Process refunds
- `payments/status.ts` - Check payment status

**Key Considerations**:
- Webhook signature verification (like Evolution)
- Payment provider API integration
- Idempotency handling for payment operations
- PCI compliance considerations
- Error handling for payment failures

**Migration Checklist**:
- [ ] List all payment endpoint files
- [ ] Read and understand webhook validation
- [ ] Convert to App Router route handlers
- [ ] Preserve all payment provider logic
- [ ] Test with payment test environments
- [ ] Verify webhook signature validation works

---

#### 2. User Profile Endpoints
**Location**: `src/pages/api/user/` (excluding /tenant which is done)
**Estimated Effort**: 1 hour
**Impact**: HIGH - User profile management

**Likely endpoints**:
- `user/[userId].ts` - Get/update user profile
- `user/profile.ts` - Current user profile
- `user/preferences.ts` - User preferences
- `user/password.ts` - Password reset/change

**Key Considerations**:
- User authentication and authorization
- Profile data validation
- Sensitive data handling
- Password change security

**Migration Checklist**:
- [ ] Identify all user endpoint files
- [ ] Determine which are active vs deprecated
- [ ] Convert to App Router
- [ ] Verify user isolation/security
- [ ] Test multi-user scenarios

---

#### 3. Admin Utility Endpoints (Summarization & Settings)
**Location**: `src/pages/api/admin/` (remaining files)
**Estimated Effort**: 1.5 hours
**Impact**: MEDIUM-HIGH - Admin features

**Specific files**:
- `admin/summarize-chat.ts` - LLM-based chat summarization
- `admin/run-summarization-scan.ts` - Batch summarization job
- `admin/tenant/[id]/settings.ts` - Tenant-specific settings

**Key Considerations**:
- LLM API integration
- Batch job coordination
- Tenant-specific configuration
- Admin-only access control

**Migration Checklist**:
- [ ] Read each remaining admin file
- [ ] Understand LLM integration (OpenRouter API?)
- [ ] Convert batch job to App Router
- [ ] Implement tenant settings endpoint
- [ ] Verify admin-only access works

---

### 🟡 MEDIUM PRIORITY - Nice to Have (2+ endpoints)

#### 4. Remaining Tenant Endpoints
**Location**: `src/pages/api/tenants/` (if any remain after staff/services)
**Estimated Effort**: 1.5 hours
**Impact**: MEDIUM

**Likely endpoints**:
- `tenants/[tenantId].ts` - Get/update tenant info
- `tenants/[tenantId]/members.ts` - Tenant member list
- `tenants/create.ts` - Create new tenant

---

#### 5. Check/Utility Endpoints
**Location**: Various `check.ts` files
**Estimated Effort**: 1 hour
**Impact**: LOW-MEDIUM

**Examples**:
- Session/auth check endpoints
- Health check endpoints
- Utility validation endpoints

---

## Investigation Checklist

Before starting Phase 1.7, verify the following:

### [ ] Directory Structure
```bash
ls -la src/pages/api/
# Check for:
# - admin/ (which files left?)
# - payments/ (all files)
# - user/ (which files left besides /tenant?)
# - tenants/ (which files left besides [tenantId]/staff.ts and [tenantId]/services.ts?)
```

### [ ] File Inventory
- [ ] Create exhaustive list of all remaining Pages Router files
- [ ] Cross-check against PAGES_ROUTER_AUDIT.md
- [ ] Mark which are active vs legacy/deprecated
- [ ] Identify any test files that can be skipped

### [ ] Active Usage Detection
For each remaining file:
- [ ] Search codebase for any imports/calls
- [ ] Check if frontend components use it
- [ ] Check if other endpoints depend on it
- [ ] Verify it's actually still used

### [ ] Dependency Mapping
- [ ] Identify external libraries used (Stripe, Paystack, etc.)
- [ ] Map LLM API integration approach
- [ ] List Supabase tables accessed
- [ ] Note any custom utility functions needed

---

## Template Migration Steps

Once endpoints identified, follow this process:

### Step 1: Create Directory
```bash
mkdir -p src/app/api/[path]/
```

### Step 2: Read Source File
- Understand all business logic
- Note external integrations
- Document RBAC requirements
- Identify request/response shapes

### Step 3: Create App Router Version
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';

/**
 * [METHOD] /api/[path]
 * Description of endpoint
 */

export async function [METHOD](request: NextRequest) {
  // Copy implementation from Pages Router
  // Change req → request
  // Change res → NextResponse
  // Change createServerSupabaseClient → getSupabaseRouteHandlerClient
}

export function OPTIONS() {
  return new NextResponse(null, { /* ... */ });
}
```

### Step 4: Verify All Patterns Applied
- [ ] `getSupabaseRouteHandlerClient()` used
- [ ] `NextRequest`/`NextResponse` used
- [ ] All RBAC logic preserved
- [ ] All error handling consistent
- [ ] OPTIONS handler present
- [ ] Query params via `searchParams`
- [ ] Dynamic params via `params`
- [ ] Logging has endpoint prefix
- [ ] All external calls preserved

### Step 5: Commit & Note in Checklist
- [ ] Add to ENDPOINTS_COMPLETION_CHECKLIST.md
- [ ] Update SESSION_FINAL_SUMMARY.md
- [ ] Update progress in manage_todo_list

---

## Potential Edge Cases to Watch For

### Payment Webhooks
- Stripe/Paystack signature verification
- Idempotency tokens
- Webhook retry handling
- Payment state machine logic

### LLM Integration
- OpenRouter API keys/configuration
- Rate limiting
- Error handling for API timeouts
- Batch processing coordination

### Settings Endpoints
- Multi-tenant isolation
- Settings schema validation
- Default values handling
- Update vs replace logic

### User Endpoints
- Password hashing/verification
- Session management
- Email verification
- Profile image handling

---

## Post-Migration Cleanup

### Phase 1.8 Tasks (5 hours)

**1. Verify All Endpoints (2 hours)**
- [ ] Create test script hitting all 29 endpoints
- [ ] Verify authentication works
- [ ] Verify authorization works
- [ ] Verify error handling
- [ ] Check response formats

**2. Remove Pages Router Directory (1 hour)**
```bash
rm -rf src/pages/api/
```

**3. Update Configuration (1.5 hours)**
- [ ] Check Next.js config for Pages Router references
- [ ] Update environment variables if needed
- [ ] Update deployment documentation
- [ ] Update API documentation

**4. Final Validation (0.5 hours)**
- [ ] Build test: `npm run build`
- [ ] Check for warnings/errors
- [ ] Verify no TypeScript errors
- [ ] Lint check: `npm run lint`

**5. Deployment Prep (0.5 hours)**
- [ ] Create migration checklist for team
- [ ] Document rollback procedure
- [ ] Prepare staging environment
- [ ] Create deployment runbook

---

## Estimated Time Breakdown

| Phase | Task | Hours |
|-------|------|-------|
| 1.7a | Identify remaining files | 0.5 |
| 1.7b | Migrate payments (3 endpoints) | 2.5 |
| 1.7c | Migrate user (1-2 endpoints) | 1 |
| 1.7d | Migrate admin utilities (2-3 endpoints) | 1.5 |
| 1.7e | Migrate misc/remaining (2+ endpoints) | 2 |
| **Total Phase 1.7** | **Migration** | **~7 hours** |
| 1.8a | Create test suite | 2 |
| 1.8b | Remove Pages Router | 1 |
| 1.8c | Update config/docs | 1.5 |
| 1.8d | Final validation & prep | 0.5 |
| **Total Phase 1.8** | **Cleanup** | **~5 hours** |
| **TOTAL** | **Phase 1 Completion** | **~12 hours** |

---

## Success Criteria for Phase 1 Completion

✅ All 29 Pages Router endpoints migrated to App Router
✅ Zero Pages Router references in codebase (except tests/old comments)
✅ `/src/pages/api/` directory removed
✅ All 29 endpoints tested and working
✅ No regressions in business logic
✅ All RBAC validations working
✅ All external integrations functional
✅ All error handling consistent
✅ All audit logging working
✅ Build passes without warnings
✅ Documentation updated
✅ Ready for production deployment

---

## Critical Reminders

⚠️ **Do NOT skip**:
- Payment webhook signature verification
- RBAC checks on admin endpoints
- Error handling for external API failures
- Audit logging of sensitive operations
- TypeScript type safety

⚠️ **Do NOT forget**:
- OPTIONS() handlers for all endpoints
- Console logging with endpoint prefix
- Status codes (201 for created, 409 for conflict, etc.)
- Request body parsing (await request.json())
- Dynamic path params extraction

⚠️ **Do NOT remove prematurely**:
- Keep Pages Router files until ALL endpoints migrated
- Have complete test coverage before removing
- Keep migration notes for team reference
- Preserve git history of old implementations

---

## Next Session Preparation

**When resuming Phase 1.7**:
1. Read this document first
2. Run `ls -la src/pages/api/` to verify remaining files
3. Create updated checklist of which files are left
4. Pick highest-impact endpoint first (payments)
5. Follow template migration steps
6. Update documentation as you go

**When ready for Phase 1.8**:
1. Ensure all 29 endpoints migrated & tested
2. Back up current codebase
3. Create feature branch for cleanup
4. Execute cleanup checklist
5. Full test suite run
6. Prepare for production deployment

---

**Last Updated**: Current session
**Phase 1 Progress**: 72% (21/29 endpoints)
**Estimated Completion**: 1-2 weeks at current pace
**Blocker Status**: No critical blockers remaining
