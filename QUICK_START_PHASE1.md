# TECH DEBT REMEDIATION - QUICK START GUIDE
**Start Date**: December 17, 2025  
**This Week's Focus**: Phase 1 - Critical Security Fixes (8-10 hours)

---

## YOUR MISSION THIS WEEK

Fix 2 critical security vulnerabilities before production deployment:

1. **Stripe webhook signature validation** (3h)
2. **Paystack webhook signature validation** (2-3h)
3. **Remove debug UI** (1-2h)
4. **Create validation tests** (2h)

**Deadline**: End of Week 1  
**Risk**: Production payment fraud vulnerability if not fixed

---

## STEP-BY-STEP GUIDE

### STEP 1: Create Webhook Validation Utilities (30 min)

**Create file**: `src/lib/webhooks/validation.ts`

```typescript
import crypto from 'crypto';

/**
 * Verify Stripe webhook signature
 * Format: t=timestamp,v1=signature
 */
export function verifyStripeSignature(
  body: string,
  headerSignature: string | undefined | null,
  webhookSecret: string
): boolean {
  if (!headerSignature) {
    console.warn('❌ Missing Stripe signature header');
    return false;
  }

  try {
    // Parse header: "t=1614556732,v1=abc123..."
    const parts = headerSignature.split(',');
    let timestamp = '';
    let signature = '';

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') signature = value;
    }

    if (!timestamp || !signature) {
      console.warn('❌ Invalid Stripe signature format');
      return false;
    }

    // Reconstruct signed content
    const signedContent = `${timestamp}.${body}`;

    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex');

    // Timing-safe comparison (prevent timing attacks)
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  } catch (error) {
    console.error('❌ Error verifying Stripe signature:', error);
    return false;
  }
}

/**
 * Verify Paystack webhook signature
 * Uses HMAC-SHA512
 */
export function verifyPaystackSignature(
  body: string,
  headerSignature: string | undefined | null,
  webhookSecret: string
): boolean {
  if (!headerSignature) {
    console.warn('❌ Missing Paystack signature header');
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(body)
      .digest('hex');

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(headerSignature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  } catch (error) {
    console.error('❌ Error verifying Paystack signature:', error);
    return false;
  }
}
```

**Time**: 30 minutes

---

### STEP 2: Update Stripe Webhook Handler (45 min)

**File**: `src/app/api/payments/stripe/route.ts`

**Add to top**:
```typescript
import { verifyStripeSignature } from '@/lib/webhooks/validation';
```

**Replace webhook handler POST function**:

```typescript
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  // Verify signature FIRST (before any processing)
  if (!verifyStripeSignature(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET || ''
  )) {
    console.warn('🚨 SECURITY: Invalid Stripe webhook signature rejected');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }

  // Only process if signature is valid
  try {
    const event = JSON.parse(rawBody);

    // Log successful verification
    console.log(`✅ Stripe webhook verified: ${event.type}`);

    // ... existing webhook logic
    // (your current code continues here)
  } catch (error) {
    console.error('❌ Error processing Stripe webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
```

**Time**: 45 minutes

---

### STEP 3: Update Paystack Webhook Handler (45 min)

**File**: `src/app/api/payments/paystack/route.ts`

**Add to top**:
```typescript
import { verifyPaystackSignature } from '@/lib/webhooks/validation';
```

**Replace webhook handler POST function**:

```typescript
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  // Verify signature FIRST
  if (!verifyPaystackSignature(
    rawBody,
    signature,
    process.env.PAYSTACK_WEBHOOK_SECRET || ''
  )) {
    console.warn('🚨 SECURITY: Invalid Paystack webhook signature rejected');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }

  try {
    const event = JSON.parse(rawBody);

    // Log successful verification
    console.log(`✅ Paystack webhook verified: ${event.event}`);

    // ... existing webhook logic
    // (your current code continues here)
  } catch (error) {
    console.error('❌ Error processing Paystack webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
```

**Time**: 45 minutes

---

### STEP 4: Create Webhook Validation Tests (1 hour)

**Create file**: `src/__tests__/webhook-validation.test.ts`

```typescript
import { 
  verifyStripeSignature, 
  verifyPaystackSignature 
} from '@/lib/webhooks/validation';
import crypto from 'crypto';

describe('Webhook Signature Validation', () => {
  const stripeSecret = 'whsec_test123';
  const paystackSecret = 'test_secret_key';

  describe('Stripe Signature Verification', () => {
    it('should reject missing signature', () => {
      const result = verifyStripeSignature(
        JSON.stringify({ test: 'data' }),
        undefined,
        stripeSecret
      );
      expect(result).toBe(false);
    });

    it('should reject invalid signature', () => {
      const result = verifyStripeSignature(
        JSON.stringify({ test: 'data' }),
        't=1614556732,v1=invalid_signature',
        stripeSecret
      );
      expect(result).toBe(false);
    });

    it('should accept valid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data' });
      const signedContent = `${timestamp}.${body}`;
      
      const signature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const result = verifyStripeSignature(
        body,
        `t=${timestamp},v1=${signature}`,
        stripeSecret
      );
      expect(result).toBe(true);
    });

    it('should reject tampered body', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data' });
      const signedContent = `${timestamp}.${body}`;
      
      const signature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      // Try with different body
      const result = verifyStripeSignature(
        JSON.stringify({ test: 'different' }),
        `t=${timestamp},v1=${signature}`,
        stripeSecret
      );
      expect(result).toBe(false);
    });
  });

  describe('Paystack Signature Verification', () => {
    it('should reject missing signature', () => {
      const result = verifyPaystackSignature(
        JSON.stringify({ test: 'data' }),
        undefined,
        paystackSecret
      );
      expect(result).toBe(false);
    });

    it('should reject invalid signature', () => {
      const result = verifyPaystackSignature(
        JSON.stringify({ test: 'data' }),
        'invalid_signature',
        paystackSecret
      );
      expect(result).toBe(false);
    });

    it('should accept valid signature', () => {
      const body = JSON.stringify({ test: 'data' });
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      const result = verifyPaystackSignature(
        body,
        expectedSignature,
        paystackSecret
      );
      expect(result).toBe(true);
    });

    it('should reject tampered body', () => {
      const body = JSON.stringify({ test: 'data' });
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      // Try with different body
      const result = verifyPaystackSignature(
        JSON.stringify({ test: 'different' }),
        expectedSignature,
        paystackSecret
      );
      expect(result).toBe(false);
    });
  });
});
```

**Run tests**:
```bash
npm test -- webhook-validation.test.ts
```

**Expected Output**:
```
PASS  src/__tests__/webhook-validation.test.ts
  Webhook Signature Validation
    Stripe Signature Verification
      ✓ should reject missing signature
      ✓ should reject invalid signature
      ✓ should accept valid signature
      ✓ should reject tampered body
    Paystack Signature Verification
      ✓ should reject missing signature
      ✓ should reject invalid signature
      ✓ should accept valid signature
      ✓ should reject tampered body

Test Suites: 1 passed
Tests:       8 passed
```

**Time**: 1 hour

---

### STEP 5: Test Against Sandbox (1 hour)

**For Stripe**:
1. Go to Stripe Dashboard → Developers → Webhooks
2. Create test webhook event
3. Send test payload to your `/api/payments/stripe` endpoint
4. Verify it processes correctly
5. Manually tamper with signature and verify it's rejected

**For Paystack**:
1. Go to Paystack Dashboard → Settings → API Keys & Webhooks
2. Send test webhook
3. Verify it processes correctly
4. Test with invalid signature

**Time**: 1 hour

---

### STEP 6: Remove Debug UI (30 min)

**File**: `src/components/AuthMagicLinkForm.tsx`

**Find this section**:
```typescript
const [debugResult, setDebugResult] = useState<string | null>(null);

async function runDebugFetch() {
  setDebugResult(null);
  // ... debug fetch logic
}
```

**Wrap with environment check**:
```typescript
const isDevelopment = process.env.NODE_ENV === 'development';

// Only create debug state in development
const [debugResult, setDebugResult] = isDevelopment 
  ? useState<string | null>(null) 
  : [null, () => {}];

async function runDebugFetch() {
  if (!isDevelopment) return; // Skip in production
  setDebugResult(null);
  // ... existing debug fetch logic
}
```

**Find debug button section** (around line 134):
```typescript
{debugResult && <div role="status" className="text-xs text-gray-700">{debugResult}</div>}
```

**Wrap it**:
```typescript
{isDevelopment && debugResult && (
  <div role="status" className="text-xs text-gray-700">{debugResult}</div>
)}
```

**Find test button**:
```typescript
<button type="button" onClick={runDebugFetch} className="text-sm text-indigo-600 hover:underline">
  Test Supabase connection
</button>
```

**Wrap it**:
```typescript
{isDevelopment && (
  <button type="button" onClick={runDebugFetch} className="text-sm text-indigo-600 hover:underline">
    Test Supabase connection
  </button>
)}
```

**Verify in production build**:
```bash
npm run build
# Debug UI should NOT be in .next folder
grep -r "Test Supabase connection" .next/ || echo "✅ Debug UI removed"
```

**Time**: 30 minutes

---

## TESTING CHECKLIST

Before committing, verify:

- [ ] All unit tests pass: `npm test`
- [ ] Type checking passes: `npm run type-check`
- [ ] No console warnings: `npm run build` (check warnings)
- [ ] Production build succeeds: `npm run build` (check .next created)
- [ ] Webhook tests pass: `npm test -- webhook-validation`
- [ ] Manual testing with sandbox APIs complete
- [ ] Code review by another dev

---

## DEPLOYMENT CHECKLIST

Before deploying to production:

- [ ] All tests passing ✅
- [ ] Build successful ✅
- [ ] Security review completed ✅
- [ ] Staging environment tested ✅
- [ ] Webhook sandbox tested ✅
- [ ] Rollback plan documented
- [ ] Team notified of changes

---

## WHAT NOT TO DO

❌ **Do NOT**:
- Deploy without testing signatures against sandbox
- Keep debug UI in production
- Skip webhook validation tests
- Manually tamper with production webhooks

✅ **DO**:
- Test thoroughly with test signatures
- Verify legitimate webhooks still work
- Check for timing attack vulnerabilities
- Log all signature validation failures

---

## NEXT STEPS (WEEK 2)

Once Phase 1 is complete:

1. **Add missing route tests** (20-30h)
   - Start: Auth routes
   - Then: Payment routes
   - Then: Data endpoints

2. **Fix type safety in tests** (8-10h)
   - Create Supabase mock types
   - Replace `as any` casting

3. **Complete notification integrations** (10-15h)
   - Email (SendGrid)
   - SMS (Twilio)
   - WhatsApp

---

## GETTING HELP

If you get stuck:

1. Check [TECH_DEBT_AUDIT_REPORT.md](TECH_DEBT_AUDIT_REPORT.md) for details
2. Review [TECH_DEBT_IMPLEMENTATION_PLAN.md](TECH_DEBT_IMPLEMENTATION_PLAN.md) for full guide
3. Stripe docs: https://stripe.com/docs/webhooks/signatures
4. Paystack docs: https://paystack.com/docs/webhook/

---

## SUCCESS CRITERIA

At end of Week 1:

✅ Stripe webhooks have signature validation  
✅ Paystack webhooks have signature validation  
✅ All webhook validation tests passing  
✅ Debug UI removed from production  
✅ Production build clean  
✅ Sandbox testing complete  
✅ Ready for deployment

---

**Good luck! 🚀**  
**Estimated time**: 8-10 hours  
**Target completion**: End of Week 1
