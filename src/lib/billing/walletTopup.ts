import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chargeAuthorization, initializeTransaction } from '@/lib/paystack';
import { resolveTenantOwner } from '@/lib/billing/walletAlerts';

/**
 * Paid wallet top-up.
 *
 * The rule this file exists to enforce: **credits enter a wallet only from a
 * payment this server can prove happened.** Before it, `topup_ai_wallet` was
 * reachable from an owner-facing route with no payment in the loop at all.
 *
 * The mechanism is the intent row. It is written BEFORE the customer pays and
 * records the tenant, the amount and the email; the webhook then credits by
 * looking those up from the row rather than believing anything in the payload,
 * which is attacker-controlled. `credit_wallet_topup` claims the intent and
 * credits the wallet in one transaction, so Paystack's webhook retries — which
 * are routine, not exceptional — cannot double-credit.
 *
 * 1 credit = NGN 1 (see messageRates.ts), so credits → kobo is × 100.
 */

const INTENTS_TABLE = 'wallet_topup_intents';

/** NGN minor units per credit. Named so the conversion is never a bare × 100. */
const KOBO_PER_CREDIT = 100;

export function creditsToMinor(credits: number): number {
  return Math.round(credits * KOBO_PER_CREDIT);
}

export type TopupOrigin = 'manual' | 'auto_recharge';

export interface CreateIntentParams {
  admin: SupabaseClient;
  tenantId: string;
  amountCredits: number;
  email: string;
  origin?: TopupOrigin;
}

export interface WalletTopupIntent {
  id: string;
  reference: string;
  amountCredits: number;
  amountMinor: number;
  email: string;
}

/**
 * Records what we are about to ask Paystack for. Returns null if the row could
 * not be written — in which case no charge may be started, because there would
 * be nothing for the webhook to credit against and the customer's money would
 * arrive with no way to attribute it.
 */
export async function createTopupIntent(
  p: CreateIntentParams,
): Promise<WalletTopupIntent | null> {
  const reference = `bokawallet_${randomUUID().replace(/-/g, '')}`;
  const amountMinor = creditsToMinor(p.amountCredits);

  const { data, error } = await p.admin
    .from(INTENTS_TABLE)
    .insert({
      tenant_id: p.tenantId,
      reference,
      amount_credits: p.amountCredits,
      amount_minor: amountMinor,
      email: p.email,
      origin: p.origin ?? 'manual',
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[walletTopup] could not record top-up intent', {
      tenantId: p.tenantId, error,
    });
    return null;
  }

  return {
    id: (data as { id: string }).id,
    reference,
    amountCredits: p.amountCredits,
    amountMinor,
    email: p.email,
  };
}

async function markIntent(
  admin: SupabaseClient,
  reference: string,
  status: 'failed' | 'abandoned',
): Promise<void> {
  const { error } = await admin
    .from(INTENTS_TABLE)
    .update({ status })
    .eq('reference', reference)
    .eq('status', 'pending');
  if (error) {
    console.warn('[walletTopup] could not mark intent', { reference, status, error });
  }
}

export interface StartCheckoutResult {
  success: boolean;
  authorizationUrl?: string;
  reference?: string;
  error?: string;
}

/**
 * Owner-facing top-up: records the intent, then hands back a Paystack checkout
 * URL. Nothing is credited here — only the verified webhook credits.
 */
export async function startWalletCheckout(params: {
  admin: SupabaseClient;
  tenantId: string;
  amountCredits: number;
  email: string;
  callbackUrl?: string;
}): Promise<StartCheckoutResult> {
  const intent = await createTopupIntent({
    admin: params.admin,
    tenantId: params.tenantId,
    amountCredits: params.amountCredits,
    email: params.email,
  });
  if (!intent) {
    return { success: false, error: 'Could not start the top-up. Please try again.' };
  }

  const init = await initializeTransaction({
    email: intent.email,
    amountMinor: intent.amountMinor,
    reference: intent.reference,
    callbackUrl: params.callbackUrl,
    // Card only: an authorization from a bank transfer or USSD payment is not
    // reusable, so any other channel produces a top-up that can never become
    // auto-recharge. Say so up front rather than discovering it at charge time.
    channels: ['card'],
    metadata: { booka_wallet_topup: true, tenant_id: params.tenantId },
  });

  if (!init.success || !init.authorizationUrl) {
    // Leave no pending intent behind for a checkout that never opened.
    await markIntent(params.admin, intent.reference, 'abandoned');
    return { success: false, error: init.error ?? 'Payment provider unavailable' };
  }

  return { success: true, authorizationUrl: init.authorizationUrl, reference: intent.reference };
}

// ─── Crediting from a verified charge ────────────────────────────────────────

export interface PaystackAuthorizationPayload {
  authorization_code?: string;
  reusable?: boolean;
  last4?: string;
  card_type?: string;
  channel?: string;
}

export interface CreditResult {
  credited: boolean;
  tenantId?: string;
  amountCredits?: number;
  reason?: string;
}

/**
 * Credits a wallet from a `charge.success` whose signature has ALREADY been
 * verified by the caller. Never call this on an unverified payload: it moves
 * money, and the reference is the only thing tying the payment to a tenant.
 */
export async function creditVerifiedTopup(params: {
  admin: SupabaseClient;
  reference: string;
  amountMinor: number;
  customerEmail?: string | null;
  authorization?: PaystackAuthorizationPayload | null;
}): Promise<CreditResult> {
  const { data, error } = await params.admin.rpc('credit_wallet_topup', {
    p_reference: params.reference,
    p_amount_minor: params.amountMinor,
  });

  if (error) {
    // Throwing would be wrong here only if the caller swallowed it; the webhook
    // route lets it surface so Paystack retries the delivery.
    console.error('[walletTopup] credit_wallet_topup failed', { reference: params.reference, error });
    throw new Error(`credit_wallet_topup failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    credited?: boolean; tenant_id?: string; amount_credits?: number | string; reason?: string;
  } | null;

  if (!row?.credited) {
    // 'no_pending_intent' is the ordinary case for a replayed webhook and for
    // every payment that is not a wallet top-up. Not an error.
    return { credited: false, tenantId: row?.tenant_id, reason: row?.reason ?? 'unknown' };
  }

  const tenantId = row.tenant_id!;
  await maybeStoreAuthorization({
    admin: params.admin,
    tenantId,
    customerEmail: params.customerEmail,
    authorization: params.authorization,
  });

  return {
    credited: true,
    tenantId,
    amountCredits: Number(row.amount_credits ?? 0),
  };
}

/**
 * Saves the card for later auto-recharge, but only if Paystack says it may be
 * reused. Storing a non-reusable authorization would produce a wallet that
 * looks armed for auto-recharge and declines every time it matters.
 *
 * The email is stored with it because Paystack rejects a charge sent with any
 * email other than the one that created the authorization, and the tenant's
 * owner email can change afterwards.
 */
async function maybeStoreAuthorization(params: {
  admin: SupabaseClient;
  tenantId: string;
  customerEmail?: string | null;
  authorization?: PaystackAuthorizationPayload | null;
}): Promise<void> {
  const auth = params.authorization;
  if (!auth?.authorization_code || auth.reusable !== true) return;
  if (!params.customerEmail) {
    console.warn('[walletTopup] reusable authorization arrived with no customer email — not stored', {
      tenantId: params.tenantId,
    });
    return;
  }

  const { error } = await params.admin
    .from('ai_wallets')
    .update({
      paystack_authorization_code: auth.authorization_code,
      paystack_authorization_email: params.customerEmail,
      paystack_card_last4: auth.last4 ?? null,
      paystack_card_brand: auth.card_type ?? null,
      paystack_authorization_saved_at: new Date().toISOString(),
      // A newly saved card clears any previous decline, so a tenant who fixes
      // their card is not left backed off forever.
      auto_recharge_failed_at: null,
      auto_recharge_failure_reason: null,
    })
    .eq('tenant_id', params.tenantId);

  if (error) {
    console.warn('[walletTopup] could not store card authorization', {
      tenantId: params.tenantId, error,
    });
  }
}

// ─── Auto-recharge ───────────────────────────────────────────────────────────

/** How long to stay backed off after a declined card. */
const DECLINE_BACKOFF_MS = 24 * 60 * 60 * 1000;

export interface AutoRechargeWallet {
  auto_recharge_enabled?: boolean | null;
  auto_recharge_amount_credits?: number | string | null;
  paystack_authorization_code?: string | null;
  paystack_authorization_email?: string | null;
  auto_recharge_failed_at?: string | null;
}

/**
 * Charges the tenant's saved card and credits the wallet.
 *
 * Returns true only when the wallet actually has more credit than it did — a
 * declined card, a missing authorization, or a disabled flag all return false,
 * and the caller falls through to grace overdraft exactly as before. This is
 * called from the reserve path, so it must never throw.
 */
export async function attemptAutoRecharge(params: {
  admin: SupabaseClient;
  tenantId: string;
  wallet: AutoRechargeWallet | null;
}): Promise<boolean> {
  const w = params.wallet;
  if (!w?.auto_recharge_enabled) return false;

  const amountCredits = Number(w.auto_recharge_amount_credits ?? 0);
  if (!Number.isFinite(amountCredits) || amountCredits <= 0) {
    console.warn('[walletTopup] auto-recharge enabled with no amount configured', {
      tenantId: params.tenantId,
    });
    return false;
  }

  if (!w.paystack_authorization_code || !w.paystack_authorization_email) {
    console.warn('[walletTopup] auto-recharge enabled with no saved card', {
      tenantId: params.tenantId,
    });
    return false;
  }

  // Back off after a decline. Without this a dead card is re-charged on every
  // single send, which is a stream of failed charges against the tenant's bank
  // and a stream of latency on Booka's inbound path.
  if (w.auto_recharge_failed_at) {
    const since = Date.now() - Date.parse(w.auto_recharge_failed_at);
    if (Number.isFinite(since) && since < DECLINE_BACKOFF_MS) return false;
  }

  const intent = await createTopupIntent({
    admin: params.admin,
    tenantId: params.tenantId,
    amountCredits,
    email: w.paystack_authorization_email,
    origin: 'auto_recharge',
  });
  if (!intent) return false;

  let charge: Awaited<ReturnType<typeof chargeAuthorization>>;
  try {
    charge = await chargeAuthorization({
      authorizationCode: w.paystack_authorization_code,
      email: w.paystack_authorization_email,
      amountMinor: intent.amountMinor,
      reference: intent.reference,
      metadata: { booka_wallet_topup: true, tenant_id: params.tenantId, origin: 'auto_recharge' },
    });
  } catch (error) {
    console.warn('[walletTopup] auto-recharge charge threw', { tenantId: params.tenantId, error });
    await markIntent(params.admin, intent.reference, 'failed');
    return false;
  }

  if (!charge.success || charge.chargeStatus !== 'success') {
    const reason = charge.gatewayResponse ?? charge.error ?? charge.chargeStatus ?? 'unknown';
    console.warn('[walletTopup] auto-recharge declined', { tenantId: params.tenantId, reason });
    await markIntent(params.admin, intent.reference, 'failed');
    await params.admin
      .from('ai_wallets')
      .update({
        auto_recharge_failed_at: new Date().toISOString(),
        auto_recharge_failure_reason: String(reason).slice(0, 200),
      })
      .eq('tenant_id', params.tenantId);
    return false;
  }

  // The charge succeeded, so credit now rather than waiting for the webhook —
  // the caller is mid-send and needs the balance in this same request. The
  // webhook will arrive later, find the intent already claimed, and no-op.
  let result: CreditResult;
  try {
    result = await creditVerifiedTopup({
      admin: params.admin,
      reference: intent.reference,
      amountMinor: intent.amountMinor,
    });
  } catch (error) {
    // The money moved but crediting failed. Loud, and recoverable: the webhook
    // for this same reference will credit it when it arrives.
    console.error('[walletTopup] auto-recharge charged but crediting failed — webhook will settle', {
      tenantId: params.tenantId, reference: intent.reference, error,
    });
    return false;
  }

  if (result.credited) {
    await params.admin
      .from('ai_wallets')
      .update({ auto_recharge_failed_at: null, auto_recharge_failure_reason: null })
      .eq('tenant_id', params.tenantId);
  }
  return result.credited;
}

/** Owner-facing contact for a checkout, preferring the verified email. */
export async function resolveTopupEmail(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const owner = await resolveTenantOwner(admin, tenantId);
  return owner?.email ?? null;
}
