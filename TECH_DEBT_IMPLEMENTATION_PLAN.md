# TECH DEBT REMEDIATION IMPLEMENTATION PLAN
**Created**: December 16, 2025  
**Target Completion**: March 2026  
**Total Effort**: 71-100 hours (Critical + High Priority)

---

## PHASE 1: CRITICAL SECURITY FIXES (Week 1) - 8-10 hours

### Objective
Fix production security vulnerabilities before deployment.

---

## 1.1 IMPLEMENT WEBHOOK SIGNATURE VALIDATION

**Priority**: 🔴 CRITICAL  
**Effort**: 5-8 hours  
**Risk**: CRITICAL - Unsigned webhooks = payment fraud risk

### 1.1.1 Stripe Webhook Signature Validation

**File**: `src/app/api/payments/stripe/route.ts`

**Implementation Steps**:

```typescript
// Step 1: Import crypto and validation utilities
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

// Step 2: Add signature validation function
function verifyStripeSignature(
  body: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  
  // Stripe uses timestamp.payload format
  const [timestamp, signatureHash] = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (key === 't') acc[0] = value;
    if (key === 'v1') acc[1] = value;
    return acc;
  }, ['', '']);
  
  const signedContent = `${timestamp}.${body}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('hex');
  
  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signatureHash),
    Buffer.from(expectedSignature)
  );
}

// Step 3: Update webhook handler
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');
  
  if (!verifyStripeSignature(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET || ''
  )) {
    console.warn('❌ Invalid Stripe signature - rejecting webhook');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }
  
  // ... existing webhook logic
}
```

**Testing**:
1. Create test webhook payloads with valid signatures
2. Test with invalid signatures (should reject)
3. Test with missing signatures (should reject)
4. Verify legitimate webhooks still process

**Files to Create**:
- `src/app/api/payments/stripe/route.test.ts` - Webhook validation tests

---

### 1.1.2 Paystack Webhook Signature Validation

**File**: `src/app/api/payments/paystack/route.ts`

**Implementation Steps**:

```typescript
// Step 1: Import crypto
import crypto from 'crypto';

// Step 2: Add Paystack signature validation
function verifyPaystackSignature(
  body: string,
  headerSignature: string | undefined,
  secret: string
): boolean {
  if (!headerSignature) return false;
  
  const hash = crypto
    .createHmac('sha512', secret)
    .update(body)
    .digest('hex');
  
  return headerSignature === hash;
}

// Step 3: Update webhook handler
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-paystack-signature');
  
  if (!verifyPaystackSignature(
    body,
    signature,
    process.env.PAYSTACK_SECRET || ''
  )) {
    console.warn('❌ Invalid Paystack signature - rejecting webhook');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }
  
  // ... existing webhook logic
}
```

**Testing**:
1. Create test payloads with valid HMAC signatures
2. Test with tampered payloads
3. Verify error logging and monitoring

**Files to Create**:
- `src/app/api/payments/paystack/route.test.ts` - Webhook validation tests

---

### 1.1.3 Add Webhook Validation Tests

**File**: `tests/webhook-validation.test.ts`

```typescript
import { POST as stripeHandler } from '@/app/api/payments/stripe/route';
import { POST as paystackHandler } from '@/app/api/payments/paystack/route';
import crypto from 'crypto';

describe('Webhook Signature Validation', () => {
  describe('Stripe Webhooks', () => {
    it('should reject webhooks with invalid signatures', async () => {
      const body = JSON.stringify({ test: 'data' });
      const invalidSignature = 't=123,v1=invalid';
      
      const request = createMockRequest(body, invalidSignature, 'stripe');
      const response = await stripeHandler(request as any);
      
      expect(response.status).toBe(401);
    });
    
    it('should accept webhooks with valid signatures', async () => {
      // Test with real signature generation
    });
  });
  
  describe('Paystack Webhooks', () => {
    it('should reject webhooks with invalid signatures', async () => {
      const body = JSON.stringify({ test: 'data' });
      const invalidSignature = crypto
        .createHmac('sha512', 'wrong_secret')
        .update(body)
        .digest('hex');
      
      const request = createMockRequest(body, invalidSignature, 'paystack');
      const response = await paystackHandler(request as any);
      
      expect(response.status).toBe(401);
    });
  });
});
```

**Deliverables**:
- ✅ Stripe signature validation (5-8h total)
- ✅ Paystack signature validation
- ✅ Comprehensive test coverage
- ✅ Webhook validation documentation

---

## 1.2 REMOVE DEBUG UI FROM PRODUCTION

**Priority**: 🔴 CRITICAL  
**Effort**: 1-2 hours  
**Risk**: Potential security exposure of connection details

### Implementation

**File**: `src/components/AuthMagicLinkForm.tsx`

**Steps**:

1. Add environment check
```typescript
const isDevelopment = process.env.NODE_ENV === 'development';

export default function AuthMagicLinkForm() {
  const [debugResult, setDebugResult] = isDevelopment 
    ? useState<string | null>(null)
    : [null];
  
  // Only show debug UI in development
  if (!isDevelopment) {
    // Production JSX without debug buttons
  }
  
  return (
    <>
      {isDevelopment && (
        <div className="development-debug-panel">
          {/* Debug buttons and output */}
        </div>
      )}
    </>
  );
}
```

2. Add code splitting to avoid including debug code in production
```typescript
// debug-helpers.ts (only imported in development)
export function runDebugFetch() { ... }
```

**Testing**:
- Build for production (`npm run build`)
- Verify debug UI not in bundle
- Test in development mode

---

## PHASE 1 SUMMARY

| Task | Effort | Status | Blocker |
|------|--------|--------|---------|
| Stripe signature validation | 3h | TODO | SECURITY |
| Paystack signature validation | 2-3h | TODO | SECURITY |
| Webhook validation tests | 2h | TODO | SECURITY |
| Remove debug UI | 1-2h | TODO | None |
| **Phase 1 Total** | **8-10h** | **CRITICAL** | **Deploy after** |

---

## PHASE 2: TEST & TYPE SAFETY (Weeks 2-3) - 40-50 hours

### Objective
Improve test coverage and eliminate type-unsafe code patterns.

---

## 2.1 FIX TEST TYPE SAFETY (`as any` Casting)

**Priority**: 🟠 HIGH  
**Effort**: 8-10 hours

### 2.1.1 Create Supabase Mock Types

**File**: `src/test/mocks/supabase-types.ts`

```typescript
import { Database } from '@/types/database';

export interface MockSelectBuilder {
  <T = any>(columns?: string): MockSelectBuilder & Promise<{ data: T[] | null; error: any }>;
  order(column: string, options?: any): MockSelectBuilder;
  eq(column: string, value: any): MockSelectBuilder;
  single(): Promise<{ data: any | null; error: any }>;
}

export interface MockTableReference {
  select: (columns?: string) => MockSelectBuilder;
  insert: (data: any) => Promise<{ data: any; error: any }>;
  update: (data: any) => MockTableReference;
  delete: () => MockTableReference;
  eq: (column: string, value: any) => MockTableReference;
}

export class MockSupabaseClient {
  from(table: string): MockTableReference {
    return {
      select: () => ({
        order: () => ({ data: [], error: null }),
        eq: () => ({ data: [], error: null }),
        single: async () => ({ data: null, error: null })
      }),
      insert: async () => ({ data: null, error: null }),
      update: () => this.from(table),
      delete: () => this.from(table),
      eq: () => this.from(table)
    };
  }
}
```

### 2.1.2 Fix Test Files

**File**: `tests/skillsApi.test.ts`

**Before**:
```typescript
const mockSupabase = {
  from: () => ({
    select: () => ({ eq: () => ({ data: [] }) })
  }) as any
};
```

**After**:
```typescript
import { MockSupabaseClient } from '@/test/mocks/supabase-types';

const mockSupabase = new MockSupabaseClient();
```

**Files to Fix**:
1. `tests/skillsApi.test.ts` - 3 fixes
2. `tests/skillsApiPatchDelete.test.ts` - 3 fixes
3. `tests/staffSkillUnassign.test.ts` - 2 fixes
4. `tests/useBookingActions.test.tsx` - 2 fixes
5. `tests/superadminHooks.test.ts` - 2 fixes
6. `tests/invitesCookies.test.ts` - 5 fixes

**Testing**:
- Run `npm test` - all tests pass
- Check type coverage: `npm run type-check`

---

## 2.2 ADD MISSING ROUTE TESTS

**Priority**: 🟠 HIGH  
**Effort**: 20-30 hours

### 2.2.1 Auth Routes Test Suite

**File**: `src/app/api/auth/me/route.test.ts`

```typescript
import { GET } from './route';
import { NextRequest } from 'next/server';

describe('GET /api/auth/me', () => {
  it('should return current user info when authenticated', async () => {
    const request = createMockRequest({
      headers: { authorization: 'Bearer valid_token' }
    });
    
    const response = await GET(request as NextRequest);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('user');
    expect(data).toHaveProperty('role');
  });
  
  it('should return 401 when not authenticated', async () => {
    const request = createMockRequest({});
    const response = await GET(request as NextRequest);
    expect(response.status).toBe(401);
  });
});
```

**Routes Requiring Tests** (15+ routes, ~2-3 hours each):

1. Auth Routes (5-6 routes):
   - `src/app/api/auth/me/route.ts`
   - `src/app/api/auth/callback/route.ts`
   - `src/app/api/auth/login/route.ts`
   - `src/app/api/auth/logout/route.ts`
   - `src/app/api/auth/refresh/route.ts`

2. Payments (3 routes):
   - `src/app/api/payments/stripe/route.ts`
   - `src/app/api/payments/paystack/route.ts`
   - `src/app/api/payments/refund/route.ts`

3. WhatsApp/Webhooks (4 routes):
   - `src/app/api/webhooks/evolution/route.ts`
   - `src/app/api/webhooks/whatsapp/route.ts`

4. Data endpoints (3 routes):
   - `src/app/api/bookings/route.ts`
   - `src/app/api/customers/route.ts`
   - `src/app/api/services/route.ts`

**Test Structure Template**:
```typescript
// For each route: auth tests, happy path, edge cases, error scenarios
describe('GET/POST /api/[endpoint]', () => {
  // 4-6 test cases per route
  it('should handle valid requests', () => {});
  it('should reject unauthorized requests', () => {});
  it('should validate input', () => {});
  it('should handle database errors', () => {});
  it('should return proper error format', () => {});
});
```

**Deliverables**:
- ✅ 15+ route test files created
- ✅ Mock utilities library
- ✅ Type-safe test helpers
- ✅ 80%+ coverage for routes

---

## 2.3 COMPLETE NOTIFICATION INTEGRATIONS

**Priority**: 🟠 HIGH  
**Effort**: 10-15 hours

### 2.3.1 Email Integration (SendGrid/AWS SES)

**File**: `src/lib/notifications/emailService.ts`

```typescript
import sgMail from '@sendgrid/mail';

export class EmailNotificationService {
  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey);
  }
  
  async sendTenantAlert(tenantId: string, alert: AlertMessage): Promise<void> {
    // Get tenant admin email
    const admin = await getTenantAdmin(tenantId);
    
    // Send email
    await sgMail.send({
      to: admin.email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: alert.subject,
      html: this.formatAlertEmail(alert),
      replyTo: 'support@booking.app'
    });
    
    // Log for audit trail
    await this.logNotification('email', tenantId, admin.email, 'sent');
  }
  
  private formatAlertEmail(alert: AlertMessage): string {
    return `
      <h2>${alert.subject}</h2>
      <p>${alert.message}</p>
      <a href="${alert.actionUrl}">View Details</a>
    `;
  }
}
```

**Implementation**:
1. Install SendGrid SDK: `npm install @sendgrid/mail`
2. Add to `.env.local`: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
3. Add integration to alert service
4. Create tests

**Effort**: 4-5h

---

### 2.3.2 SMS Integration (Twilio)

**File**: `src/lib/notifications/smsService.ts`

```typescript
import twilio from 'twilio';

export class SMSNotificationService {
  private client: any;
  
  constructor(accountSid: string, authToken: string) {
    this.client = twilio(accountSid, authToken);
  }
  
  async sendTenantAlert(phoneNumber: string, message: string): Promise<void> {
    const result = await this.client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    await this.logNotification('sms', phoneNumber, result.sid);
  }
}
```

**Implementation**:
1. Install Twilio: `npm install twilio`
2. Add env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
3. Integrate with alert service
4. Create tests

**Effort**: 3-4h

---

### 2.3.3 WhatsApp Business API

**File**: `src/lib/notifications/whatsappService.ts`

```typescript
export class WhatsAppNotificationService {
  async sendTenantAlert(phoneNumber: string, alert: AlertMessage): Promise<void> {
    // Use existing Evolution API client
    await this.whatsappClient.sendMessage({
      recipient: phoneNumber,
      type: 'text',
      body: {
        text: this.formatWhatsAppMessage(alert)
      }
    });
  }
  
  private formatWhatsAppMessage(alert: AlertMessage): string {
    return `*${alert.subject}*\n${alert.message}\n\nView: ${alert.actionUrl}`;
  }
}
```

**Implementation**:
1. Integrate with existing Evolution API client
2. Format messages for WhatsApp
3. Add error handling and retries
4. Create tests

**Effort**: 3-4h

---

### 2.3.4 Alert Service Integration

**File**: `src/lib/llmAlertService.ts` (Update)

```typescript
import { EmailNotificationService } from './notifications/emailService';
import { SMSNotificationService } from './notifications/smsService';
import { WhatsAppNotificationService } from './notifications/whatsappService';

export class EnhancedAlertService {
  private email: EmailNotificationService;
  private sms: SMSNotificationService;
  private whatsapp: WhatsAppNotificationService;
  
  constructor() {
    this.email = new EmailNotificationService(process.env.SENDGRID_API_KEY!);
    this.sms = new SMSNotificationService(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
    this.whatsapp = new WhatsAppNotificationService();
  }
  
  // Replace TODO stubs
  async notifyTenantAdmins(tenantId: string, alert: AlertMessage): Promise<void> {
    const admins = await this.getTenantAdmins(tenantId);
    
    await Promise.all([
      ...admins.map(a => this.email.sendTenantAlert(tenantId, alert)),
      ...admins.filter(a => a.phone).map(a => this.sms.sendTenantAlert(a.phone, alert.message)),
      ...admins.filter(a => a.whatsapp).map(a => this.whatsapp.sendTenantAlert(a.whatsapp, alert))
    ]);
  }
}
```

**Deliverables**:
- ✅ Email notification service (SendGrid)
- ✅ SMS notification service (Twilio)
- ✅ WhatsApp notification service
- ✅ Integrated alert system
- ✅ Tests for all services

---

## PHASE 2 SUMMARY

| Task | Effort | Status |
|------|--------|--------|
| Fix test type safety | 8-10h | TODO |
| Create route tests (15+ routes) | 20-30h | TODO |
| Email integration | 4-5h | TODO |
| SMS integration | 3-4h | TODO |
| WhatsApp integration | 3-4h | TODO |
| **Phase 2 Total** | **40-50h** | **HIGH** |

---

## PHASE 3: CODE QUALITY (Weeks 4-6) - 40-50 hours

### Objective
Migrate from deprecated code, improve error handling, add error boundaries.

---

## 3.1 MIGRATE FROM DEPRECATED PERMISSIONS

**Priority**: 🟡 MEDIUM  
**Effort**: 20-30 hours

### 3.1.1 Audit Usage of Deprecated Permissions

**File**: `scripts/audit-permissions.ts`

```typescript
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

async function findDeprecatedPermissionUsage() {
  const srcDir = join(process.cwd(), 'src');
  const deprecatedPatterns = [
    /from.*unified-permissions.*deprecated/,
    /validateTenantAccess/,
    /getUserRoleForTenant/,
    /isGlobalAdmin/
  ];
  
  const results = [];
  
  async function scanDirectory(dir: string) {
    const files = await readdir(dir);
    for (const file of files) {
      const path = join(dir, file);
      if (path.includes('node_modules')) continue;
      
      const content = await readFile(path, 'utf-8');
      for (const pattern of deprecatedPatterns) {
        if (pattern.test(content)) {
          results.push({ file: path, pattern: pattern.source });
        }
      }
    }
  }
  
  await scanDirectory(srcDir);
  console.log(JSON.stringify(results, null, 2));
}

findDeprecatedPermissionUsage();
```

**Expected Findings**: 6-12 files using deprecated permissions

---

### 3.1.2 Create Migration Guide

**File**: `docs/PERMISSIONS_MIGRATION.md`

```markdown
# Permissions System Migration Guide

## Old (Deprecated) → New (Unified) Mapping

### Before
\`\`\`typescript
import { validateTenantAccess } from '@/lib/permissions/unified-permissions';
const hasAccess = await validateTenantAccess(userId, tenantId, 'admin');
\`\`\`

### After
\`\`\`typescript
import { hasUnifiedPermission } from '@/types/unified-permissions';
const hasAccess = await hasUnifiedPermission(
  userId,
  tenantId,
  'tenant:admin:write'
);
\`\`\`

## Migration Checklist
- [ ] Find all deprecated usage
- [ ] Update imports to unified system
- [ ] Update permission checks
- [ ] Add tests
- [ ] Verify no regressions
```

### 3.1.3 Execute Migration (3-5 files at a time)

**Example Migration**:

**Before** (`src/app/api/users/route.ts`):
```typescript
import { validateTenantAccess } from '@/lib/permissions/unified-permissions';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  const tenantId = request.headers.get('x-tenant-id');
  
  if (!await validateTenantAccess(userId, tenantId, 'admin')) {
    return new Response('Forbidden', { status: 403 });
  }
  // ...
}
```

**After**:
```typescript
import { hasUnifiedPermission } from '@/types/unified-permissions';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  const tenantId = request.headers.get('x-tenant-id');
  
  if (!await hasUnifiedPermission(userId, tenantId, 'tenant:users:read')) {
    return new Response('Forbidden', { status: 403 });
  }
  // ...
}
```

**Files to Migrate** (estimate 6-12 files):
1. Auth route handlers
2. Admin route handlers
3. Data access route handlers
4. Components using permissions

**Testing per file**:
- ✅ Component/route still works
- ✅ Same users still have access
- ✅ Same users still blocked when needed
- ✅ No console errors

**Effort**: 20-30h (4-6 hours per file including testing)

---

## 3.2 IMPROVE ERROR HANDLING & ADD ERROR BOUNDARIES

**Priority**: 🟡 MEDIUM  
**Effort**: 15-20 hours

### 3.2.1 Create Error Boundary Component

**File**: `src/components/ErrorBoundary.tsx`

```typescript
import React, { ReactNode, ErrorInfo } from 'react';
import { reportErrorToLogging } from '@/lib/observability';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to observability
    reportErrorToLogging({
      type: 'react_error_boundary',
      error,
      componentStack: errorInfo.componentStack,
      severity: 'high'
    });
    
    this.props.onError?.(error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="error-fallback">
            <h2>Something went wrong</h2>
            <details style={{ whiteSpace: 'pre-wrap' }}>
              {this.state.error?.toString()}
            </details>
          </div>
        )
      );
    }
    
    return this.props.children;
  }
}
```

### 3.2.2 Apply Error Boundaries

**Files to Wrap** (5-8 high-risk components):

**Example** (`src/app/dashboard/page.tsx`):
```typescript
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function DashboardPage() {
  return (
    <ErrorBoundary 
      fallback={<DashboardErrorFallback />}
      onError={(error) => console.error('Dashboard error:', error)}
    >
      <DashboardContent />
    </ErrorBoundary>
  );
}
```

**Components to Wrap Priority**:
1. 🔴 Dashboard page
2. 🔴 Calendar component
3. 🔴 Booking flow
4. 🟠 Analytics panels
5. 🟠 Admin sections

### 3.2.3 Improve Error Logging

**File**: `src/lib/errorHandling.ts`

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleError(error: unknown, context?: Record<string, any>) {
  if (error instanceof AppError) {
    // Handle expected errors
    reportError({
      type: 'app_error',
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      context: { ...error.context, ...context }
    });
    return { message: error.message, code: error.code };
  }
  
  // Handle unexpected errors
  reportError({
    type: 'unexpected_error',
    message: String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context
  });
  
  return { message: 'An unexpected error occurred', code: 'INTERNAL_ERROR' };
}
```

### 3.2.4 Replace Silent Catches

**Before** (`src/lib/whatsapp/messageDeduplicator.ts`):
```typescript
} catch (error) {
  console.error('Error scheduling notification:', error);
  // Silent failure - admins never know
}
```

**After**:
```typescript
} catch (error) {
  const result = handleError(error, {
    operation: 'scheduleNotification',
    bookingId: booking.id,
    tenantId: booking.tenantId
  });
  
  // Alert admins of critical failure
  await notifyTenantAdmins(booking.tenantId, {
    type: 'critical_alert',
    message: `Notification scheduling failed: ${result.message}`,
    actionUrl: `/admin/logs?code=${result.code}`
  });
  
  // Re-throw or return error
  throw new AppError(
    'Notification scheduling failed',
    'NOTIFICATION_ERROR',
    500
  );
}
```

**Error Patterns to Fix** (15-20 occurrences):
- Silent console.error catches
- Unlogged database failures
- API response errors not propagated
- Missing error context

**Deliverables**:
- ✅ ErrorBoundary component
- ✅ Error boundaries on 5-8 high-risk pages
- ✅ Improved error logging
- ✅ Better error recovery
- ✅ Tests for error scenarios

**Effort**: 15-20h

---

## 3.3 REMOVE DEPRECATED FILES

**Priority**: 🟡 MEDIUM  
**Effort**: 8-12 hours

### 3.3.1 Deprecated Components

**Files to Remove**:
1. `src/components/StaffAnalytics.tsx` - 2-3h migration
2. `src/components/ManagerAnalytics.tsx` - 2-3h migration
3. `src/app/dashboard/analytics/page.tsx` - 1-2h migration

**Migration Process**:
1. Find all imports of deprecated component
2. Replace with new AnalyticsDashboard
3. Update component props to use role parameter
4. Test all role variants (staff, manager, admin)
5. Remove deprecated file

### 3.3.2 Deprecated Infrastructure

**Files to Remove** (2-3h):
- `vitest.config.ts` - Remove (already using Jest)
- `src/test/vitestShim.ts` - Remove
- `src/test/setupTests.ts` - Remove

**Verify**:
- No remaining imports of vitest
- Jest setup complete
- Tests pass

**Deliverables**:
- ✅ All deprecated components migrated
- ✅ All deprecated infrastructure removed
- ✅ No broken references
- ✅ All tests passing

---

## PHASE 3 SUMMARY

| Task | Effort | Status |
|------|--------|--------|
| Migrate deprecated permissions | 20-30h | TODO |
| Add error boundaries | 8-12h | TODO |
| Improve error handling | 7-8h | TODO |
| Remove deprecated files | 8-10h | TODO |
| **Phase 3 Total** | **40-50h** | **MEDIUM** |

---

## PHASE 4: LONG-TERM OPTIMIZATION (Weeks 7-12) - Next 100+ hours

### Objective
Performance optimization and code refactoring (lower urgency, can be spread across months).

---

## 4.1 PERFORMANCE PROFILING & OPTIMIZATION

**Effort**: 10-15h (Investigation only; fixes spread across time)

**Steps**:
1. Enable query logging in development
2. Profile N+1 query patterns
3. Identify cache opportunities
4. Optimize critical paths

---

## 4.2 COMPONENT REFACTORING

**Effort**: 120-200h (Spread over months)

**Areas**:
- React component optimization (memoization, code splitting)
- Consolidate duplicate code
- Improve accessibility
- Better TypeScript usage

---

## IMPLEMENTATION TRACKING

### Create Implementation Checklist

**File**: `IMPLEMENTATION_TRACKING.md`

```markdown
# Tech Debt Implementation Tracking

## Phase 1: Critical (Week 1)
- [ ] Stripe webhook validation (3h) - Start: -- End: --
- [ ] Paystack webhook validation (2-3h) - Start: -- End: --
- [ ] Webhook validation tests (2h) - Start: -- End: --
- [ ] Remove debug UI (1-2h) - Start: -- End: --
- [ ] Deploy Phase 1 fixes

## Phase 2: High Priority (Weeks 2-3)
- [ ] Create Supabase mock types (3h) - Start: -- End: --
- [ ] Fix test type safety (5-7h) - Start: -- End: --
- [ ] Add auth route tests (3-4h) - Start: -- End: --
- [ ] Add payment route tests (2-3h) - Start: -- End: --
- [ ] Add webhook route tests (2h) - Start: -- End: --
- [ ] Complete email integration (4-5h) - Start: -- End: --
- [ ] Complete SMS integration (3-4h) - Start: -- End: --
- [ ] Complete WhatsApp integration (3-4h) - Start: -- End: --

## Phase 3: Medium Priority (Weeks 4-6)
- [ ] Audit deprecated permissions usage (2h) - Start: -- End: --
- [ ] Migrate file 1 (4-6h) - Start: -- End: --
- [ ] Migrate file 2-5 (20-25h) - Start: -- End: --
- [ ] Create error boundary (2-3h) - Start: -- End: --
- [ ] Apply error boundaries (5-8h) - Start: -- End: --
- [ ] Improve error logging (3-4h) - Start: -- End: --
- [ ] Remove deprecated components (4-6h) - Start: -- End: --
- [ ] Remove deprecated infrastructure (2-3h) - Start: -- End: --

## Metrics
- Test Coverage: Before: 60-70% → Target: >85%
- Type Safety: Before: 85% → Target: >95%
- Tech Debt Score: Before: 65/100 → Target: >85/100
- Compilation Errors: 0 (maintained)
```

---

## DEPLOYMENT STRATEGY

### Pre-Deployment Validation

**Checklist**:
- ✅ All tests passing
- ✅ No type errors (`npm run type-check`)
- ✅ Build successful (`npm run build`)
- ✅ Webhook validation tested against sandbox APIs
- ✅ Error boundaries tested in QA environment
- ✅ No console warnings/errors

### Rollout Plan

**Phase 1 (Critical)**: Direct production deployment (security fix)
- Stripe webhook validation
- Paystack webhook validation
- Remove debug UI
- Immediate: No staged rollout needed (security fix)

**Phase 2+ (Lower Risk)**: Staged rollout
- Deploy to staging first
- QA validation
- Canary deployment to 10% users
- Monitor error rates
- Full rollout if stable

---

## SUCCESS CRITERIA

### Phase 1 Success
- ✅ All webhooks have signature validation
- ✅ Debug UI removed from production
- ✅ Zero security issues reported
- ✅ All webhook tests passing

### Phase 2 Success
- ✅ Test coverage >80%
- ✅ No `as any` or `@ts-ignore` in main code
- ✅ All routes have unit tests
- ✅ Notification integrations working
- ✅ No type errors

### Phase 3 Success
- ✅ No usage of deprecated permissions
- ✅ All components migrated
- ✅ Error boundaries on critical paths
- ✅ Better error logging and recovery

### Overall Success
- ✅ Tech Debt Score: 85+/100
- ✅ Type Safety: 95%+
- ✅ Test Coverage: 85%+
- ✅ Build: Clean, 0 errors
- ✅ Production: Stable and secure

---

## RESOURCE ALLOCATION

### Recommended Team Composition
- **1 Senior Developer**: Architecture, critical fixes, code review
- **1-2 Mid-level Developers**: Implementation, testing
- **1 QA Engineer**: Testing, validation, deployment verification

### Time Allocation
- Critical (Phase 1): 1 week, highest priority
- High (Phase 2): 2-3 weeks, scheduled next
- Medium (Phase 3): 2-3 weeks, following Phase 2
- Low (Phase 4): Ongoing, 5-10 hours/week

---

## RISK MITIGATION

### Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Webhook changes break payments | Low | Critical | Extensive testing, sandbox validation, canary deploy |
| Migration causes auth issues | Medium | High | Comprehensive testing, parallel run approach |
| Performance regression | Low | Medium | Profile before/after, monitoring |
| Team velocity slower than estimated | Medium | Medium | Buffer: +20% time estimate, prioritize critical items |

---

## COMMUNICATION PLAN

### Weekly Status Updates
- Monday: Week kickoff, assign tasks
- Wednesday: Mid-week check-in, address blockers
- Friday: Completion summary, plan next week

### Stakeholder Communication
- **Daily**: Team standup (15 min)
- **Weekly**: Status update to leadership
- **Phase Completion**: Demo of completed work

---

## SUMMARY

**Total Effort (Critical + High)**: 71-100 hours  
**Timeline**: 2-3 months (8-12 weeks)  
**Key Wins**:
- ✅ Production security vulnerabilities fixed
- ✅ Test coverage increased from 60-70% to 85%+
- ✅ Type safety improved from 85% to 95%+
- ✅ Tech debt reduced from 65/100 to 85+/100
- ✅ Deprecated code eliminated
- ✅ Better error handling and observability

---

**Plan Created**: December 16, 2025  
**Next Review Date**: December 23, 2025  
**Implementation Start**: December 17, 2025
