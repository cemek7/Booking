// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createHash } from 'crypto';
import metrics from './metrics';
import { trace } from '@opentelemetry/api';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

/** Generate a deterministic idempotency key from tenant + reservation */
function generateIdempotencyKey(tenantId: string, reservationId: string): string {
  return createHash('sha256').update(`${tenantId}:${reservationId}`).digest('hex');
}

export interface DepositIntentInput {
  tenant_id: string;
  reservation_id: string;
  amount_minor_units: number; // e.g. kobo/cents
  currency: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DepositIntentResult {
  id: string | null;
  status: 'created' | 'failed';
  provider?: string;
  payment_url?: string | null;
  error?: string | null;
}

export interface StandalonePaymentLinkInput {
  tenant_id: string;
  reference_key: string;
  amount_minor_units: number;
  currency: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  callback_url?: string | null;
  tenantDefaultProvider?: string;
  /** Tenant's Paystack subaccount — settles the split to their bank, not the platform. */
  subaccountCode?: string | null;
  /** Who bears the Paystack fee when a subaccount is used. Default 'account' (platform). */
  bearer?: 'account' | 'subaccount';
}

export interface StandalonePaymentLinkResult {
  id: string | null;
  status: 'created' | 'failed';
  provider?: string;
  payment_url?: string | null;
  error?: string | null;
}

export interface PaymentProvider {
  name: string;
  createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult>;
  verifyWebhook?(rawBody: string, headers: Record<string, string>): Promise<{ ok: boolean; event?: string; data?: Record<string, unknown>; error?: string }>; // optional
}

function env(key: string) { return process.env[key]; }

// Paystack stub implementation
export class PaystackProvider implements PaymentProvider {
  name = 'paystack';
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    if (!env('PAYSTACK_SECRET_KEY')) return { id: null, status: 'failed', provider: this.name, error: 'missing_credentials' };
    try {
      const amount = input.amount_minor_units; // already minor units
      const idempotencyKey = generateIdempotencyKey(input.tenant_id, input.reservation_id);
      const resp = await fetchWithTimeout('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}` },
        body: JSON.stringify({ amount, email: input.customer_email || 'noemail@example.com', reference: idempotencyKey, metadata: input.metadata || {} }),
        timeoutMs: 15_000,
      });
      const j = await resp.json().catch(() => ({}));
      const payUrl = j?.data?.authorization_url || null;
      const ref = j?.data?.reference || null;
      await metrics.incr('deposit_intent_paystack');
      return { id: ref, status: resp.ok ? 'created' : 'failed', provider: this.name, payment_url: payUrl, error: resp.ok ? null : `status_${resp.status}` };
    } catch (e) {
      return { id: null, status: 'failed', provider: this.name, error: (e as Error).message };
    }
  }
}

// Stripe stub implementation
export class StripeProvider implements PaymentProvider {
  name = 'stripe';
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    if (!env('STRIPE_SECRET_KEY')) return { id: null, status: 'failed', provider: this.name, error: 'missing_credentials' };
    try {
      const amount = input.amount_minor_units; // minor units
      const idempotencyKey = generateIdempotencyKey(input.tenant_id, input.reservation_id);
      const resp = await fetchWithTimeout('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Idempotency-Key': idempotencyKey },
        body: new URLSearchParams({ amount: String(amount), currency: input.currency.toLowerCase(), metadata: JSON.stringify(input.metadata || {}) }),
        timeoutMs: 15_000,
      });
      const j = await resp.json().catch(() => ({}));
      const id = j?.id || null;
      const clientSecret = j?.client_secret || null;
      await metrics.incr('deposit_intent_stripe');
      return { id, status: resp.ok ? 'created' : 'failed', provider: this.name, payment_url: clientSecret, error: resp.ok ? null : `status_${resp.status}` };
    } catch (e) {
      return { id: null, status: 'failed', provider: this.name, error: (e as Error).message };
    }
  }
}

export interface PaymentsAdapterConfig {
  paystack?: boolean;
  stripe?: boolean;
  /** Explicit default provider name. Paystack is the MVP default. */
  defaultProvider?: 'paystack' | 'stripe';
}

export class PaymentsAdapter {
  providers: Record<string, PaymentProvider> = {};
  private defaultProvider: string;

  constructor(cfg: PaymentsAdapterConfig = {}) {
    if (cfg.paystack !== false) this.providers.paystack = new PaystackProvider();
    if (cfg.stripe !== false) this.providers.stripe = new StripeProvider();
    // Paystack is the MVP default; tenant can override via config
    this.defaultProvider = cfg.defaultProvider ?? 'paystack';
  }

  pickProvider(currency: string, tenantDefaultProvider?: string): PaymentProvider | null {
    // 1. Tenant-level explicit override
    const tenantPref = tenantDefaultProvider?.toLowerCase();
    if (tenantPref && this.providers[tenantPref]) return this.providers[tenantPref];
    // 2. Adapter-level default (Paystack for MVP)
    if (this.defaultProvider && this.providers[this.defaultProvider]) return this.providers[this.defaultProvider];
    // 3. Currency fallback: NGN -> paystack, others -> stripe
    if (currency.toUpperCase() === 'NGN' && this.providers.paystack) return this.providers.paystack;
    if (this.providers.stripe) return this.providers.stripe;
    return null;
  }
  async createDeposit(input: DepositIntentInput & { tenantDefaultProvider?: string }): Promise<DepositIntentResult> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('payments.createDeposit', { attributes: { 'tenant.id': input.tenant_id, 'reservation.id': input.reservation_id, 'currency': input.currency } });
    const provider = this.pickProvider(input.currency, input.tenantDefaultProvider);
    if (!provider) {
      span.setAttribute('deposit.status', 'no_provider');
      span.end();
      return { id: null, status: 'failed', error: 'no_provider' };
    }
    const res = await provider.createDepositIntent(input);
    span.setAttribute('deposit.provider', provider.name);
    span.setAttribute('deposit.status', res.status);
    if (res.id) span.setAttribute('deposit.intent_id', res.id);
    span.end();
    return res;
  }

  async createStandalonePaymentLink(input: StandalonePaymentLinkInput): Promise<StandalonePaymentLinkResult> {
    const provider = this.pickProvider(input.currency, input.tenantDefaultProvider);
    if (!provider) {
      return { id: null, status: 'failed', error: 'no_provider' };
    }

    if (provider.name === 'paystack') {
      return createPaystackStandalonePaymentLink(input);
    }

    if (provider.name === 'stripe') {
      return createStripeStandalonePaymentLink(input);
    }

    return {
      id: null,
      status: 'failed',
      provider: provider.name,
      error: 'provider_not_supported',
    };
  }
}

async function createPaystackStandalonePaymentLink(
  input: StandalonePaymentLinkInput
): Promise<StandalonePaymentLinkResult> {
  if (!env('PAYSTACK_SECRET_KEY')) {
    return { id: null, status: 'failed', provider: 'paystack', error: 'missing_credentials' };
  }

  try {
    const resp = await fetchWithTimeout('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}`,
      },
      body: JSON.stringify({
        amount: input.amount_minor_units,
        email: input.customer_email || 'noemail@example.com',
        reference: input.reference_key,
        callback_url: input.callback_url || undefined,
        metadata: input.metadata || {},
        // Split settlement to the tenant's bank when a subaccount is configured.
        subaccount: input.subaccountCode || undefined,
        bearer: input.subaccountCode ? (input.bearer || 'account') : undefined,
      }),
      timeoutMs: 15_000,
    });
    const j = await resp.json().catch(() => ({}));
    return {
      id: j?.data?.reference || input.reference_key,
      status: resp.ok ? 'created' : 'failed',
      provider: 'paystack',
      payment_url: j?.data?.authorization_url || null,
      error: resp.ok ? null : `status_${resp.status}`,
    };
  } catch (e) {
    return { id: null, status: 'failed', provider: 'paystack', error: (e as Error).message };
  }
}

async function createStripeStandalonePaymentLink(
  input: StandalonePaymentLinkInput
): Promise<StandalonePaymentLinkResult> {
  if (!env('STRIPE_SECRET_KEY')) {
    return { id: null, status: 'failed', provider: 'stripe', error: 'missing_credentials' };
  }

  try {
    const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
    const successUrl = input.callback_url || `${baseUrl}/dashboard/orders?payment=success`;
    const cancelUrl = input.callback_url || `${baseUrl}/dashboard/orders?payment=cancelled`;
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': input.description || 'Retail order payment',
      'line_items[0][price_data][unit_amount]': String(input.amount_minor_units),
      'line_items[0][quantity]': '1',
      'client_reference_id': input.reference_key,
      'metadata[reference_key]': input.reference_key,
      'metadata[tenant_id]': input.tenant_id,
    });
    const resp = await fetchWithTimeout('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`,
      },
      body,
      timeoutMs: 15_000,
    });
    const j = await resp.json().catch(() => ({}));
    return {
      id: j?.id || input.reference_key,
      status: resp.ok ? 'created' : 'failed',
      provider: 'stripe',
      payment_url: j?.url || null,
      error: resp.ok ? null : `status_${resp.status}`,
    };
  } catch (e) {
    return { id: null, status: 'failed', provider: 'stripe', error: (e as Error).message };
  }
}

// Persistence helper for transactions row (type=deposit)
export async function recordDepositTransaction(supabase: SupabaseClient, tenantId: string, reservationId: string, minorAmount: number, currency: string, provider: string, ref: string | null) {
  try {
    await supabase.from('transactions').insert({ tenant_id: tenantId, amount: minorAmount / 100, currency, type: 'deposit', status: 'initiated', raw: { provider, ref, reservation_id: reservationId } });
  } catch (e) {
    defaultLogger.warn('recordDepositTransaction failed', e);
  }
}

// Helper: initiate deposit for a reservation using tenant metadata deposit_pct (if present)
export async function initiateDepositForReservation(
  supabase: SupabaseClient,
  adapter: PaymentsAdapter,
  tenantId: string,
  reservationId: string,
  baseAmountMinor: number,
  currency: string
) {
  try {
    const { data: tenant } = await supabase.from('tenants').select('id, metadata').eq('id', tenantId).maybeSingle();
    const meta = tenant?.metadata && typeof tenant.metadata === 'object' ? (tenant.metadata as Record<string, unknown>) : {};
    const depositPctRaw = meta['deposit_pct'];
    const depositPct = typeof depositPctRaw === 'number' ? depositPctRaw : null;
    if (!depositPct || depositPct <= 0 || depositPct >= 100) return { skipped: 'invalid_deposit_pct' };
    const depositMinor = Math.round(baseAmountMinor * (depositPct / 100));
    // Idempotency: check existing transaction for reservation & provider
    const { data: existing } = await supabase
      .from('transactions')
      .select('id, raw')
      .eq('tenant_id', tenantId)
      .filter('raw->>reservation_id', 'eq', reservationId)
      .eq('type', 'deposit')
      .limit(1);
    if (existing && existing.length > 0) {
      return { id: (existing[0] as any)?.raw?.ref || null, status: 'created', provider: (existing[0] as any)?.raw?.provider, payment_url: null };
    }
    const intent = await adapter.createDeposit({ tenant_id: tenantId, reservation_id: reservationId, amount_minor_units: depositMinor, currency });
    if (intent.status === 'created') {
      await recordDepositTransaction(supabase, tenantId, reservationId, depositMinor, currency, intent.provider || 'unknown', intent.id);
    }
    return intent;
  } catch (e) {
    defaultLogger.warn('initiateDepositForReservation failed', e);
    return { id: null, status: 'failed', error: (e as Error).message };
  }
}

export default { PaymentsAdapter, PaystackProvider, StripeProvider, recordDepositTransaction, initiateDepositForReservation };
