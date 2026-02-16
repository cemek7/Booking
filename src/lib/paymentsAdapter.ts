import { createServerSupabaseClient } from '@/lib/supabase/server';
import metrics from './metrics';
import { trace } from '@opentelemetry/api';

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
      const resp = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}` },
        body: JSON.stringify({ amount, email: input.customer_email || 'noemail@example.com', metadata: input.metadata || {} })
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
      const resp = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}` },
        body: new URLSearchParams({ amount: String(amount), currency: input.currency.toLowerCase(), metadata: JSON.stringify(input.metadata || {}) })
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

export interface PaymentsAdapterConfig { paystack?: boolean; stripe?: boolean; }

export class PaymentsAdapter {
  providers: Record<string, PaymentProvider> = {};
  constructor(cfg: PaymentsAdapterConfig = {}) {
    if (cfg.paystack !== false) this.providers.paystack = new PaystackProvider();
    if (cfg.stripe !== false) this.providers.stripe = new StripeProvider();
  }
  pickProvider(currency: string): PaymentProvider | null {
    // naive: NGN -> paystack; others -> stripe
    if (currency.toUpperCase() === 'NGN' && this.providers.paystack) return this.providers.paystack;
    if (this.providers.stripe) return this.providers.stripe;
    return null;
  }
  async createDeposit(input: DepositIntentInput): Promise<DepositIntentResult> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('payments.createDeposit', { attributes: { 'tenant.id': input.tenant_id, 'reservation.id': input.reservation_id, 'currency': input.currency } });
    const provider = this.pickProvider(input.currency);
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
}

// Persistence helper for transactions row (type=deposit)
export async function recordDepositTransaction(supabase: SupabaseClient, tenantId: string, reservationId: string, minorAmount: number, currency: string, provider: string, ref: string | null) {
  try {
    await supabase.from('transactions').insert({ tenant_id: tenantId, amount: minorAmount / 100, currency, type: 'deposit', status: 'initiated', raw: { provider, ref, reservation_id: reservationId } });
  } catch (e) {
    console.warn('recordDepositTransaction failed', e);
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
      .eq('raw->>reservation_id', reservationId)
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
    console.warn('initiateDepositForReservation failed', e);
    return { id: null, status: 'failed', error: (e as Error).message };
  }
}

export default { PaymentsAdapter, PaystackProvider, StripeProvider, recordDepositTransaction, initiateDepositForReservation };
