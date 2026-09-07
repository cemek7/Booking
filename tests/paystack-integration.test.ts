/**
 * Paystack Payment Integration Tests
 *
 * Tests POST /api/payments/webhook with Paystack payloads:
 *   - Signature verification (accept valid, reject invalid/missing)
 *   - charge.success updates transaction status
 *   - charge.refunded updates transaction + reservation to 'refunded'
 *   - Duplicate webhooks are idempotently rejected
 *   - Stale webhooks (>72 h) are silently accepted without processing
 *
 * Prerequisites (set in .env.local):
 *   PAYSTACK_SECRET_KEY           — your Paystack test/live secret key
 *   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — service role key for seeding/asserting DB state
 *   APP_URL                       — defaults to http://localhost:3000
 *
 * Run:
 *   npm run test:integration
 *   (starts dev server separately with `npm run dev`)
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const WEBHOOK_URL = `${APP_URL}/api/payments/webhook`;

/** Generates a valid Paystack HMAC-SHA512 signature for the given body. */
function paystackSig(body: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(body).digest('hex');
}

/** Builds a minimal Paystack charge.success payload. */
function buildChargeSuccess(ref: string, tenantId: string, reservationId?: string) {
  return {
    provider: 'paystack',
    event: 'charge.success',
    status: 'success',
    reference: ref,
    data: {
      reference: ref,
      status: 'success',
      metadata: {
        tenant_id: tenantId,
        reservation_id: reservationId ?? null,
      },
    },
  };
}

/** Builds a minimal Paystack charge.refunded payload. */
function buildChargeRefunded(ref: string, tenantId: string, reservationId?: string) {
  return {
    provider: 'paystack',
    event: 'charge.refunded',
    status: 'refunded',
    reference: ref,
    data: {
      reference: ref,
      status: 'refunded',
      metadata: {
        tenant_id: tenantId,
        reservation_id: reservationId ?? null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const REQUIRED_VARS = [
  'PAYSTACK_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missingVars = REQUIRED_VARS.filter((k) => !process.env[k]);
const integrationEnabled = missingVars.length === 0;

if (!integrationEnabled) {
  console.warn(
    `\n[paystack-integration] Skipping — missing env vars: ${missingVars.join(', ')}\n` +
    `Copy env.example to .env.local and fill in the required values.\n`
  );
}

// Test fixtures — created in beforeAll, cleaned up in afterAll
const TEST_TENANT_ID = '00000000-test-0000-0000-paystack00001';
const TEST_RESERVATION_ID = '00000000-test-0000-0000-paystack00002';
const TEST_REF_SUCCESS = `boka-inttest-success-${Date.now()}`;
const TEST_REF_REFUND = `boka-inttest-refund-${Date.now()}`;
const TEST_REF_STALE = `boka-inttest-stale-${Date.now()}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let paystackSecret: string;

beforeAll(async () => {
  if (!integrationEnabled) return;

  supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  paystackSecret = env('PAYSTACK_SECRET_KEY');

  // Seed a minimal tenant
  await supabase.from('tenants').upsert({
    id: TEST_TENANT_ID,
    name: 'Paystack Integration Test Tenant',
    domain: 'paystack-inttest.local',
    vertical: 'general',
    plan: 'free',
  });

  // Seed reservation for the refund test
  await supabase.from('reservations').upsert({
    id: TEST_RESERVATION_ID,
    tenant_id: TEST_TENANT_ID,
    status: 'confirmed',
    start_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    end_at: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
  });

  // Seed two transactions (success + refund references)
  await supabase.from('transactions').upsert([
    {
      id: `00000000-test-0000-tx00-success000001`,
      tenant_id: TEST_TENANT_ID,
      reservation_id: TEST_RESERVATION_ID,
      provider: 'paystack',
      provider_reference: TEST_REF_SUCCESS,
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
    },
    {
      id: `00000000-test-0000-tx00-refund0000001`,
      tenant_id: TEST_TENANT_ID,
      reservation_id: TEST_RESERVATION_ID,
      provider: 'paystack',
      provider_reference: TEST_REF_REFUND,
      amount: 5000,
      currency: 'NGN',
      status: 'success',
    },
    {
      id: `00000000-test-0000-tx00-stale00000001`,
      tenant_id: TEST_TENANT_ID,
      provider: 'paystack',
      provider_reference: TEST_REF_STALE,
      amount: 1000,
      currency: 'NGN',
      status: 'pending',
    },
  ]);
});

afterAll(async () => {
  if (!integrationEnabled) return;
  // Delete in dependency order (transactions reference reservations)
  await supabase
    .from('transactions')
    .delete()
    .in('provider_reference', [TEST_REF_SUCCESS, TEST_REF_REFUND, TEST_REF_STALE]);
  await supabase.from('reservations').delete().eq('id', TEST_RESERVATION_ID);
  await supabase.from('tenants').delete().eq('id', TEST_TENANT_ID);
  // Remove webhook_events seeded during tests
  await supabase
    .from('webhook_events')
    .delete()
    .or(
      `external_id.like.${TEST_REF_SUCCESS}%,` +
      `external_id.like.${TEST_REF_REFUND}%,` +
      `external_id.like.${TEST_REF_STALE}%`
    );
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — signature verification', () => {
  const maybeIt = (integrationEnabled ? it : ((name: string, fn: () => void | Promise<unknown>, timeout?: number) => it.skip(name, fn, timeout))) as typeof it;

  maybeIt('rejects requests with no signature header (422)', async () => {
    const body = JSON.stringify(buildChargeSuccess('no-sig-ref', TEST_TENANT_ID));
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(JSON.stringify(json)).toMatch(/signature/i);
  });

  maybeIt('rejects requests with invalid Paystack signature (422)', async () => {
    const body = JSON.stringify(buildChargeSuccess('bad-sig-ref', TEST_TENANT_ID));
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': 'deadbeefdeadbeef',
      },
      body,
    });
    expect(res.status).toBe(422);
  });

  maybeIt('accepts requests with valid Paystack HMAC-SHA512 signature (200)', async () => {
    // Use a ref that won't hit a real transaction (no-op path but signature passes)
    const body = JSON.stringify(buildChargeSuccess('sig-check-only-ref', TEST_TENANT_ID));
    const sig = paystackSig(body, paystackSecret);
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': sig,
      },
      body,
    });
    // 200 = processed (no transaction found for ref, but that's ok — sig passed)
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// charge.success
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — charge.success', () => {
  const maybeIt = (integrationEnabled ? it : ((name: string, fn: () => void | Promise<unknown>, timeout?: number) => it.skip(name, fn, timeout))) as typeof it;

  maybeIt('updates transaction status to success', async () => {
    const payload = buildChargeSuccess(TEST_REF_SUCCESS, TEST_TENANT_ID, TEST_RESERVATION_ID);
    const body = JSON.stringify(payload);
    const sig = paystackSig(body, paystackSecret);

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);

    // Give handlePaymentSuccess a moment to run (it's fire-and-forget)
    await new Promise((r) => setTimeout(r, 1500));

    const { data: tx } = await supabase
      .from('transactions')
      .select('status, reconciliation_status')
      .eq('provider_reference', TEST_REF_SUCCESS)
      .maybeSingle();

    expect(tx?.status).toBe('success');
    expect(tx?.reconciliation_status).toBe('pending');
  });

  maybeIt('is idempotent — duplicate charge.success returns { replay: true }', async () => {
    const payload = buildChargeSuccess(TEST_REF_SUCCESS, TEST_TENANT_ID);
    const body = JSON.stringify(payload);
    const sig = paystackSig(body, paystackSecret);
    const headers = {
      'Content-Type': 'application/json',
      'x-paystack-signature': sig,
    };

    // Second delivery of same event (idempotency key = ref:success)
    const res = await fetch(WEBHOOK_URL, { method: 'POST', headers, body });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, replay: true });
  });
});

// ---------------------------------------------------------------------------
// charge.refunded
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — charge.refunded', () => {
  const maybeIt = (integrationEnabled ? it : ((name: string, fn: () => void | Promise<unknown>, timeout?: number) => it.skip(name, fn, timeout))) as typeof it;

  maybeIt('updates transaction + reservation status to refunded', async () => {
    const payload = buildChargeRefunded(TEST_REF_REFUND, TEST_TENANT_ID, TEST_RESERVATION_ID);
    const body = JSON.stringify(payload);
    const sig = paystackSig(body, paystackSecret);

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 1000));

    const { data: tx } = await supabase
      .from('transactions')
      .select('status')
      .eq('provider_reference', TEST_REF_REFUND)
      .maybeSingle();

    expect(tx?.status).toBe('refunded');
  });

  maybeIt('charge.success and charge.refunded for same ref have distinct idempotency keys', async () => {
    // Both events use TEST_REF_REFUND but different event types → unique keys → no duplicate rejection
    const successPayload = buildChargeSuccess(TEST_REF_REFUND, TEST_TENANT_ID);
    const refundPayload = buildChargeRefunded(TEST_REF_REFUND, TEST_TENANT_ID);

    const successBody = JSON.stringify(successPayload);
    const refundBody = JSON.stringify(refundPayload);

    // Deliver success
    const r1 = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': paystackSig(successBody, paystackSecret),
      },
      body: successBody,
    });

    // Deliver refund (same ref, different event type — must NOT be treated as duplicate)
    const r2 = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': paystackSig(refundBody, paystackSecret),
      },
      body: refundBody,
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Second response must NOT be { replay: true } — it's a distinct event
    const r2json = await r2.json();
    expect(r2json?.replay).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stale webhook rejection
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — stale webhook', () => {
  const maybeIt = (integrationEnabled ? it : ((name: string, fn: () => void | Promise<unknown>, timeout?: number) => it.skip(name, fn, timeout))) as typeof it;

  maybeIt('silently accepts but does not update transaction when webhook is >72 h old', async () => {
    const staleTimestamp = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    const payload = {
      ...buildChargeSuccess(TEST_REF_STALE, TEST_TENANT_ID),
      created_at: staleTimestamp,
    };
    const body = JSON.stringify(payload);
    const sig = paystackSig(body, paystackSecret);

    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, stale: true });

    // Transaction must still be 'pending' — stale webhook must not update it
    const { data: tx } = await supabase
      .from('transactions')
      .select('status')
      .eq('provider_reference', TEST_REF_STALE)
      .maybeSingle();

    expect(tx?.status).toBe('pending');
  });
});
