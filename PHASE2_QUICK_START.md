# PHASE 2 QUICK START - TEST COVERAGE & TYPE SAFETY
**Start Date**: December 19, 2025  
**This Week's Focus**: Phase 2 - Test Coverage & Type Safety (40-50 hours)

---

## YOUR MISSION THIS PHASE

Build comprehensive test coverage and fix type safety issues:

1. **Create missing route tests** (20-30h)
2. **Fix type safety in tests** (8-10h)
3. **Complete notification integrations** (10-15h)

**Deadline**: End of 3 weeks (December 30-January 10)  
**Impact**: Increase test coverage from 60-70% to 85%+, eliminate `as any` casting

---

## PRIORITY BREAKDOWN

### 🔴 PRIORITY 1: CREATE MISSING ROUTE TESTS (20-30h)
**Highest impact for stability**

#### Tier 1 Routes (Critical - 8 routes, ~15h)
These are frequently used and need immediate test coverage:

1. **Authentication Routes** (3-4h)
   - `/api/auth/me` - Get current user
   - `/api/auth/logout` - Logout functionality
   - `/api/auth/callback` - OAuth callback
   - Tests needed: Success, unauthorized, invalid token

2. **Payment Routes** (5-6h)  
   - `/api/payments/webhook` - Webhook handler (✅ DONE in Phase 1)
   - `/api/payments/stripe` - (✅ DONE in Phase 1)
   - `/api/payments/paystack` - (✅ DONE in Phase 1)
   - `/api/payments/retry` - Retry failed payments
   - `/api/payments/refund` - Process refunds
   - Tests needed: Valid payloads, invalid payloads, error scenarios

3. **User/Tenant Routes** (3-4h)
   - `/api/user/tenant` - Get user's tenant
   - `/api/tenants/[tenantId]/settings` - Tenant settings
   - `/api/tenant-users/[userId]/role` - User role management
   - Tests needed: Authorization, data validation, updates

4. **Data Retrieval Routes** (2-3h)
   - `/api/customers` - List customers
   - `/api/staff` - List staff
   - `/api/skills` - List skills
   - Tests needed: Pagination, filtering, authorization

#### Tier 2 Routes (Important - 8-12 routes, ~10-15h)
These are important but less critical:

1. **Booking Routes** (3-4h)
   - `/api/bookings` - CRUD operations
   - `/api/bookings/[id]` - Individual booking
   - Tests needed: CRUD operations, availability checks

2. **WhatsApp Routes** (2-3h)
   - `/api/whatsapp/webhook` - Message webhook
   - `/api/tenants/[tenantId]/whatsapp/connect` - Connection setup
   - Tests needed: Message handling, connection

3. **Analytics Routes** (2-3h)
   - `/api/superadmin/dashboard` - Dashboard data
   - `/api/customers/[id]/stats` - Customer stats
   - Tests needed: Data aggregation, permissions

4. **Webhook Routes** (2-3h)
   - `/api/webhooks/evolution` - Evolution webhook
   - Tests needed: Event processing, error handling

---

### 🟠 PRIORITY 2: FIX TYPE SAFETY IN TESTS (8-10h)
**Eliminate type casting issues**

#### Locate & Fix `as any` Casting
**Found 20+ instances across test files:**

Files with casting issues:
- `tests/skillsApi.test.ts` - 5+ instances
- `tests/skillsPatchDelete.test.ts` - 3+ instances
- `tests/staffSkillUnassign.test.ts` - 2+ instances
- `tests/invitesCookies.test.ts` - 5+ instances
- `tests/llmQuota.test.ts` - 2+ instances
- `tests/onboardingApi.test.ts` - 1+ instances

#### Create Supabase Mock Types Library (3-4h)

**Create**: `src/test/mocks/supabase-types.ts`

```typescript
// Mock types for Supabase database operations
interface MockSupabaseQuery {
  select: (fields?: string) => MockSupabaseQuery;
  insert: (data: any) => MockSupabaseQuery;
  update: (data: any) => MockSupabaseQuery;
  delete: () => MockSupabaseQuery;
  eq: (field: string, value: any) => MockSupabaseQuery;
  single: () => Promise<{ data?: any; error?: any }>;
  maybeSingle: () => Promise<{ data?: any; error?: any }>;
}

interface MockSupabaseClient {
  from: (table: string) => MockSupabaseQuery;
}

// Type-safe response wrapper
interface SupabaseResponse<T> {
  data: T | null;
  error: Error | null;
}
```

#### Replace Casting (5-6h)

**Before**:
```typescript
const mockSupabase = {
  from: (table: string) => ({
    select: () => ({ maybeSingle: () => Promise.resolve({ data: mockUser }) })
  })
} as any;
```

**After**:
```typescript
const mockSupabase = createMockSupabaseClient({
  users: mockUser,
  tenants: mockTenant,
  skills: mockSkills
});
```

---

### 🟡 PRIORITY 3: NOTIFICATION INTEGRATIONS (10-15h)
**Enable communication with users**

#### Email Service - SendGrid (4-5h)

**Create**: `src/lib/integrations/email-service.ts`

```typescript
import { SendGridClient } from '@sendgrid/mail';

export async function sendEmail(to: string, subject: string, html: string) {
  const client = new SendGridClient(process.env.SENDGRID_API_KEY);
  return client.send({
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject,
    html,
  });
}

// Pre-built templates
export async function sendWelcomeEmail(email: string, name: string) {
  return sendEmail(email, 'Welcome!', `Hello ${name}...`);
}

export async function sendBookingConfirmation(email: string, bookingId: string) {
  return sendEmail(email, 'Booking Confirmed', `Your booking ${bookingId} is confirmed...`);
}
```

#### SMS Service - Twilio (3-4h)

**Create**: `src/lib/integrations/sms-service.ts`

```typescript
import twilio from 'twilio';

export async function sendSMS(to: string, message: string) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
}

// Pre-built templates
export async function sendBookingReminder(phone: string, bookingTime: string) {
  return sendSMS(phone, `Reminder: You have a booking at ${bookingTime}`);
}
```

#### WhatsApp Service (3-4h)

**Create**: `src/lib/integrations/whatsapp-service.ts`

```typescript
import axios from 'axios';

export async function sendWhatsAppMessage(to: string, message: string) {
  const response = await axios.post(
    `${process.env.EVOLUTION_API_URL}/message/sendText/${to}`,
    { text: message },
    {
      headers: {
        'api-key': process.env.EVOLUTION_API_KEY,
      },
    }
  );
  return response.data;
}

// Pre-built templates
export async function sendBookingNotification(phone: string, bookingId: string) {
  return sendWhatsAppMessage(
    phone,
    `Your booking ${bookingId} has been confirmed. Click here to view details.`
  );
}
```

---

## STEP-BY-STEP IMPLEMENTATION

### WEEK 1: Route Tests (Tier 1)

**Task 1: Create Test Template**
- Create `src/__tests__/api/template.test.ts`
- Standard setup: mocks, fixtures, helper functions
- Makes other tests faster to create

**Task 2: Authentication Tests** (3-4h)
- `/api/auth/me`
- `/api/auth/logout`
- Test: Success, errors, unauthorized

**Task 3: Payment Tests** (5-6h)
- `/api/payments/retry`
- `/api/payments/refund`
- Test: Valid inputs, errors, edge cases

**Task 4: User/Tenant Tests** (3-4h)
- `/api/user/tenant`
- `/api/tenants/[tenantId]/settings`
- Test: CRUD operations, authorization

**Task 5: Data Retrieval Tests** (2-3h)
- `/api/customers`
- `/api/staff`
- Test: Pagination, filtering

### WEEK 2: Type Safety + Tier 2 Routes

**Task 1: Create Mock Types Library** (3-4h)
- `src/test/mocks/supabase-types.ts`
- Replace `as any` in existing tests

**Task 2: Fix Type Casting** (5-6h)
- Update test files to use new mock types
- Remove `as any` from all test code
- Verify all tests still pass

**Task 3: Tier 2 Routes** (10-12h)
- Booking routes
- WhatsApp routes
- Analytics routes
- Webhook routes

### WEEK 3: Notifications + Polish

**Task 1: Email Service** (4-5h)
- SendGrid integration
- Templates
- Tests

**Task 2: SMS Service** (3-4h)
- Twilio integration
- Templates
- Tests

**Task 3: WhatsApp Service** (3-4h)
- Evolution API integration
- Templates
- Tests

**Task 4: Final Verification** (2-3h)
- Run all tests
- Verify coverage
- Document changes

---

## TEST TEMPLATE

Use this template for new route tests:

```typescript
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { NextRequest } from 'next/server';

// Mock Supabase client
const mockSupabaseClient = {
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: '1', name: 'Test' },
      error: null,
    }),
  })),
};

describe('GET /api/example', () => {
  it('should return data successfully', async () => {
    const request = new NextRequest('http://localhost/api/example');
    
    // Mock authentication
    jest.mock('@/lib/auth', () => ({
      getSession: jest.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'test@example.com' },
      }),
    }));

    // Your test here
    const response = await GET(request);
    const data = await response.json();

    expect(data).toEqual({ id: '1', name: 'Test' });
  });

  it('should handle unauthorized access', async () => {
    const request = new NextRequest('http://localhost/api/example');
    
    // Mock no auth
    jest.mock('@/lib/auth', () => ({
      getSession: jest.fn().mockResolvedValue(null),
    }));

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
```

---

## SUCCESS CRITERIA

### Week 1
- [ ] Test template created
- [ ] Authentication routes tested
- [ ] Payment routes tested
- [ ] User/tenant routes tested
- [ ] Data retrieval routes tested
- [ ] All tests passing

### Week 2
- [ ] Mock types library created
- [ ] All `as any` casting removed from existing tests
- [ ] Type safety tests passing
- [ ] Tier 2 routes tested
- [ ] Coverage increased to 75%+

### Week 3
- [ ] Email service integrated
- [ ] SMS service integrated
- [ ] WhatsApp service integrated
- [ ] All notification tests passing
- [ ] Coverage at 85%+
- [ ] Ready for Phase 3

---

## TESTING CHECKLIST

Before committing each component:

- [ ] All new tests pass
- [ ] Existing tests still pass
- [ ] No TypeScript errors
- [ ] Coverage increased
- [ ] Code review complete
- [ ] Documentation updated

---

## NEXT STEPS

**After Phase 2 (January 10)**:
- Start Phase 3: Code Quality & Error Handling
- Migrate from deprecated code
- Improve error boundaries
- Add comprehensive error logging

---

## TIME ESTIMATES

| Task | Tier | Est. Hours | Week |
|------|------|-----------|------|
| Test template | - | 1-2h | 1 |
| Auth routes | 1 | 3-4h | 1 |
| Payment routes | 1 | 5-6h | 1 |
| User/tenant routes | 1 | 3-4h | 1 |
| Data routes | 1 | 2-3h | 1 |
| Mock types | - | 3-4h | 2 |
| Fix type casting | - | 5-6h | 2 |
| Tier 2 routes | 2 | 10-12h | 2 |
| Email service | - | 4-5h | 3 |
| SMS service | - | 3-4h | 3 |
| WhatsApp service | - | 3-4h | 3 |
| Final verification | - | 2-3h | 3 |
| **TOTAL** | - | **~45-55h** | **3w** |

---

**Ready to start Phase 2! 🚀**

**Estimated completion**: January 10, 2026  
**Next phase**: Phase 3 (Code Quality)
