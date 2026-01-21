# BOOKA MVP SHIPPING PLAN

## Decisions Made
- **Public Storefront**: `book.booka.io/[slug]` format
- **Defaults**: Use existing `tenants.settings` JSONB column
- **No-Show Auto-Cancel**: 24 hours before appointment
- **WhatsApp Agent**: Add owner approval step (currently auto-confirms!)

---

## PART A: PUBLIC BOOKING STOREFRONT

### Current State
- **0% built** - No public-facing booking page exists
- Booking engine exists but no customer-facing UI
- No tenant slug system

### Implementation Plan

#### Phase 1: Database Changes (Day 1)

```sql
-- Migration: add_tenant_slug.sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Generate slugs for existing tenants
UPDATE tenants
SET slug = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || SUBSTRING(id::text, 1, 4)
WHERE slug IS NULL;

-- Add index for fast lookup
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Add constraint
ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;
```

#### Phase 2: Public API Routes (Day 1-2)

Create `/api/public/[slug]` routes (no auth required):

```
src/app/api/public/
├── [slug]/
│   ├── route.ts              # GET tenant info (name, logo, description)
│   ├── services/route.ts     # GET available services
│   ├── availability/route.ts # GET available slots for date
│   └── book/route.ts         # POST create booking (pending status)
```

**Key Security Considerations:**
- Rate limiting per IP
- CAPTCHA for booking submission
- No sensitive tenant data exposed
- Bookings created as `pending` (not `confirmed`)

#### Phase 3: Public Booking Page (Day 2-4)

```
src/app/book/
├── [slug]/
│   ├── page.tsx              # Main booking page
│   ├── loading.tsx           # Loading skeleton
│   └── not-found.tsx         # Invalid slug handler
```

**Page Components:**

```tsx
// src/app/book/[slug]/page.tsx
export default async function PublicBookingPage({ params }: { params: { slug: string } }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <TenantHeader slug={params.slug} />
      <ServiceSelector slug={params.slug} />
      <DateTimePicker />
      <CustomerForm />
      <BookingSummary />
    </div>
  );
}
```

**Component Tree:**
```
PublicBookingPage
├── TenantHeader          # Business name, logo, description
├── ServiceSelector       # Grid/list of services with prices
├── DateTimePicker        # Calendar + time slot selector
├── CustomerForm          # Name, phone, email (required)
├── BookingSummary        # Review before submit
└── ConfirmationScreen    # Success + add to calendar
```

#### Phase 4: Mobile-First Styling (Day 4)

- Single-column layout on mobile
- Large tap targets for time slots
- Sticky booking summary on scroll
- Auto-scroll to next section

### Files to Create

| File | Purpose |
|------|---------|
| `src/app/book/[slug]/page.tsx` | Main booking page |
| `src/app/api/public/[slug]/route.ts` | Tenant info endpoint |
| `src/app/api/public/[slug]/services/route.ts` | Services list |
| `src/app/api/public/[slug]/availability/route.ts` | Available slots |
| `src/app/api/public/[slug]/book/route.ts` | Create booking |
| `src/components/booking/PublicServiceCard.tsx` | Service display |
| `src/components/booking/TimeSlotPicker.tsx` | Slot selection |
| `src/components/booking/CustomerBookingForm.tsx` | Customer details |
| `supabase/migrations/XXX_add_tenant_slug.sql` | Database migration |

---

## PART B: TENANT SETTINGS SCHEMA

### Current State
- Settings stored in `tenants.settings` JSONB column
- API exists at `/api/tenants/[tenantId]/settings`
- Comprehensive schema already defined in route

### Existing Settings (from route.ts)

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `displayName` | string | - | Public business name |
| `timezone` | string | - | Business timezone |
| `businessHours` | object | - | Hours per day |
| `reminderLead` | number | - | Minutes before reminder |
| `secondReminderLead` | number | - | Second reminder timing |
| `requireDeposit` | boolean | false | Require payment |
| `depositPercent` | number | - | Deposit percentage |
| `cancellationPolicy` | string | - | Policy text |
| `staffAssignmentStrategy` | enum | - | round_robin/preferred/skill_based |
| `allowOverbooking` | boolean | false | Allow double-book |
| `whatsappNumber` | string | - | WhatsApp business number |
| `evolutionInstance` | string | - | WhatsApp API instance |

### Missing Settings to Add

```typescript
// Add to SettingsSchemaBase in route.ts

// Booking defaults
bookingBufferMinutes: z.number().int().min(0).default(15),
defaultServiceDuration: z.number().int().min(15).default(60),
maxAdvanceBookingDays: z.number().int().min(1).default(60),
minAdvanceBookingHours: z.number().int().min(0).default(2),

// No-show settings
autoConfirmEnabled: z.boolean().default(false),
confirmationDeadlineHours: z.number().int().min(1).default(24),
autoCancelUnconfirmedEnabled: z.boolean().default(true),
autoCancelHoursBefore: z.number().int().min(1).default(24),

// WhatsApp agent settings
requireOwnerApproval: z.boolean().default(true),
autoConfirmThreshold: z.number().int().min(0).default(0), // 0 = always require approval

// Public storefront
publicBookingEnabled: z.boolean().default(true),
publicDescription: z.string().max(500).optional(),
publicLogo: z.string().url().optional(),
```

### Migration for Defaults

```sql
-- Migration: add_booking_defaults.sql

-- Set sensible defaults for existing tenants
UPDATE tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'bookingBufferMinutes', 15,
  'defaultServiceDuration', 60,
  'maxAdvanceBookingDays', 60,
  'minAdvanceBookingHours', 2,
  'autoCancelUnconfirmedEnabled', true,
  'autoCancelHoursBefore', 24,
  'requireOwnerApproval', true,
  'publicBookingEnabled', true
)
WHERE settings IS NULL OR settings = '{}'::jsonb;
```

---

## PART C: BRUTAL MVP CUT LIST (2 WEEKS)

### WEEK 1: Core Flow

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Add tenant slug column | Migration + slug generation |
| 1 | Public tenant API | `/api/public/[slug]` - tenant info |
| 2 | Public services API | `/api/public/[slug]/services` |
| 2 | Public availability API | `/api/public/[slug]/availability` |
| 3 | Public booking API | `/api/public/[slug]/book` (creates pending) |
| 3 | Basic booking page shell | `/book/[slug]` with service list |
| 4 | Time slot picker | Calendar + slot selection |
| 4 | Customer form | Name, phone, email |
| 5 | Booking confirmation | Success screen + booking reference |

### WEEK 2: Make It Work

| Day | Task | Deliverable |
|-----|------|-------------|
| 6 | Owner approval flow | Dashboard notification for pending bookings |
| 6 | WhatsApp agent fix | Change status to `pending_approval` |
| 7 | Auto-cancel job | Cron job for 24h unconfirmed bookings |
| 7 | Confirmation nudge | WhatsApp message to confirm |
| 8 | Customer notes field | Add to customers table + UI |
| 8 | Booking history view | Show previous bookings on customer profile |
| 9 | Mobile polish | Responsive fixes, tap targets |
| 10 | Testing + Bug fixes | End-to-end testing |

### OUT OF SCOPE (Defer)

- Custom themes/branding
- Payment integration in public form
- Multi-language support
- Staff selection by customer
- Recurring bookings
- Waitlist management
- Email confirmations (WhatsApp only)

### Success Criteria

1. Customer can book via `book.booka.io/[slug]`
2. Owner gets WhatsApp notification of new booking
3. Owner can approve/reject from dashboard
4. Unconfirmed bookings auto-cancel at 24h
5. Customer gets confirmation via WhatsApp

---

## PART D: WHATSAPP AGENT FIXES

### Current Problem

In `src/lib/whatsappBookingFlow.ts` line 284-286:

```typescript
const bookingData = {
  // ...
  status: 'confirmed',  // <-- BUG: Should be 'pending_approval'
  // ...
};
```

**Bookings are auto-confirmed without owner approval!**

### Fix Required

```typescript
// Change createBooking method in whatsappBookingFlow.ts

private async createBooking(state: BookingFlowState): Promise<BookingResult> {
  // Get tenant settings
  const { data: tenant } = await this.supabase
    .from('tenants')
    .select('settings')
    .eq('id', state.tenantId)
    .single();

  const settings = tenant?.settings || {};
  const requireApproval = settings.requireOwnerApproval !== false;

  const bookingData = {
    tenant_id: state.tenantId,
    customer_phone: state.customerPhone,
    customer_name: state.customerName || 'WhatsApp Customer',
    service_type: state.serviceType,
    booking_date: state.selectedDate,
    booking_time: state.selectedTime,
    status: requireApproval ? 'pending_approval' : 'confirmed',  // <-- FIX
    source: 'whatsapp',
    created_at: new Date().toISOString()
  };

  // ... rest of method

  // Notify owner if pending approval
  if (requireApproval) {
    await this.notifyOwnerOfPendingBooking(bookingData);
  }
}
```

### Owner Notification Flow

```typescript
private async notifyOwnerOfPendingBooking(booking: any) {
  // Get owner's phone from tenant_users
  const { data: owner } = await this.supabase
    .from('tenant_users')
    .select('user_id, users!inner(phone)')
    .eq('tenant_id', booking.tenant_id)
    .eq('role', 'owner')
    .single();

  if (owner?.users?.phone) {
    const message = `New booking request:\n\n` +
      `Customer: ${booking.customer_name}\n` +
      `Service: ${booking.service_type}\n` +
      `Date: ${booking.booking_date}\n` +
      `Time: ${booking.booking_time}\n\n` +
      `Reply APPROVE ${booking.id.slice(-4)} or REJECT ${booking.id.slice(-4)}`;

    await this.evolutionClient.sendMessage(
      booking.tenant_id,
      owner.users.phone,
      message
    );
  }
}
```

### Intent Detector Prompt

Current prompt in `intentDetector.ts` (line 59-64):

```typescript
const system = `You are an advanced booking intent classifier. Analyze the message and return JSON with:
- intent: booking|reschedule|cancel|inquiry|unknown
- confidence: 0-1 number (be conservative, use context)
- entities: array of {type, value, confidence} objects for time, date, service, staff, phone, email, name
- context: {hasTimeReference, hasServiceMention, hasStaffPreference, isUrgent, sentiment}
Only return valid JSON.`;
```

**This is fine.** The prompt is focused and doesn't over-promise. The issue is in the booking flow, not intent detection.

### New Booking Status Flow

```
Customer sends "I want to book a haircut tomorrow"
    ↓
Intent detected: booking (confidence: 0.85)
    ↓
Bot: "What service?" → Customer: "Haircut"
    ↓
Bot: "What time?" → Customer: "2pm"
    ↓
Bot: "Confirm?" → Customer: "Yes"
    ↓
Booking created with status: 'pending_approval'  ← NEW
    ↓
Bot: "Request submitted! The business will confirm shortly."  ← NEW
    ↓
Owner gets WhatsApp: "New booking request... Reply APPROVE/REJECT"  ← NEW
    ↓
Owner: "APPROVE 1234"
    ↓
Booking status → 'confirmed'
Customer gets: "Your booking is confirmed!"
```

---

## SUMMARY: WHAT TO BUILD

### Critical Path (Must Ship)

1. **Public Booking Page** - `/book/[slug]`
2. **Owner Approval Flow** - Fix auto-confirm bug
3. **Auto-Cancel Job** - 24h unconfirmed → cancelled

### Nice to Have (If Time)

4. Customer notes field
5. Booking history display
6. Confirmation nudges

### Not Now

- Payment in booking flow
- Custom branding
- Multi-language
- Staff selection

---

## NEXT STEPS

1. Create migration for tenant slug
2. Fix WhatsApp agent to use `pending_approval`
3. Build public booking page
4. Add owner notification
5. Create auto-cancel cron job

Start with the WhatsApp fix - it's a 10-line change that prevents a major UX problem.
