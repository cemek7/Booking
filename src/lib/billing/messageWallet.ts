import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveMessageSellCredits,
  isShadowMode,
  getGraceOverdraftDefault,
} from '@/lib/billing/messageRates';
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';

const CHARGES_TABLE = 'whatsapp_message_charges';

export type ReserveMode = 'paid' | 'grace' | 'free' | 'shadow';
export type MessageKind = 'freeform' | 'template' | 'interactive' | 'media';

export interface ReserveOutboundParams {
  admin: SupabaseClient;
  tenantId: string;
  provider: string;
  messageKind: MessageKind;
  attribution?: Record<string, unknown>;
}

export type ReserveOutboundResult =
  // chargeId is null when no charge row exists to correlate: the internal-error
  // fallback below. Callers must null-check before calling attachWamid.
  | { allow: true; chargeId: string | null; mode: ReserveMode }
  | { allow: false; reason: 'handoff' };

export interface SettleOutboundParams {
  admin: SupabaseClient;
  tenantId: string;
  wamid: string;
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed';
  pricing?: {
    billable?: boolean;
    category?: string;
    type?: string;
    pricing_model?: string;
  };
}

type ReserveRpcRow = {
  allowed?: boolean;
  balance_credits?: number | string | null;
  reservation_id?: string | null;
  reason?: string | null;
};

type SettleRpcRow = {
  allowed?: boolean;
  balance_credits?: number | string | null;
  settlement_id?: string | null;
  reason?: string | null;
};

type ChargeRow = {
  id: string;
  status?: string | null;
  reserved_credits?: number | string | null;
  wallet_reservation_id?: string | null;
};

type WalletRow = {
  message_rate_credits?: number | string | null;
  grace_overdraft_credits?: number | string | null;
  auto_recharge_enabled?: boolean | null;
};

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

async function insertChargeRow(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await admin
    .from(CHARGES_TABLE)
    .insert(row)
    .select('id')
    .single();
  if (error) {
    console.warn('[messageWallet] insertChargeRow failed', error);
    return null;
  }
  const inserted = data as { id?: string } | null;
  return inserted?.id ?? null;
}

async function callReserveRpc(
  admin: SupabaseClient,
  tenantId: string,
  amountCredits: number,
  allowOverdraftCredits: number,
  messageKind: MessageKind,
  attribution?: Record<string, unknown>,
): Promise<{ allowed: boolean; reservationId: string | null; reason: string | null }> {
  const { data, error } = await admin.rpc('reserve_ai_wallet_spend', {
    p_tenant_id: tenantId,
    p_amount_credits: amountCredits,
    p_request_id: null,
    p_provider: 'meta',
    p_model: null,
    p_description: `WhatsApp ${messageKind} message`,
    p_metadata: attribution ?? {},
    p_allow_overdraft_credits: allowOverdraftCredits,
    p_meter: 'whatsapp',
  });

  if (error) {
    return { allowed: false, reservationId: null, reason: error.message ?? 'reserve_error' };
  }

  const row = firstRow<ReserveRpcRow>(data);
  return {
    allowed: !!row?.allowed,
    reservationId: row?.reservation_id ?? null,
    reason: row?.reason ?? null,
  };
}

/**
 * Reserves wallet credit for one outbound WhatsApp message before it is sent.
 * Never throws: an internal metering bug must not take a tenant's bot offline.
 */
export async function reserveOutboundMessage(p: ReserveOutboundParams): Promise<ReserveOutboundResult> {
  try {
    if (p.provider !== 'meta') {
      // Non-Meta providers (e.g. WAHA) are not billed by Meta at all. Record the
      // send at zero cost so Meta-vs-WAHA economics stay comparable per tenant.
      const chargeId = await insertChargeRow(p.admin, {
        tenant_id: p.tenantId,
        provider: p.provider,
        status: 'reserved',
        reserved_credits: 0,
        mode: 'live',
        message_kind: p.messageKind,
        attribution: p.attribution ?? {},
      });
      return { allow: true, chargeId, mode: 'free' };
    }

    if (isShadowMode()) {
      // Shadow mode records volume for calibration but never gates or moves money.
      const chargeId = await insertChargeRow(p.admin, {
        tenant_id: p.tenantId,
        provider: p.provider,
        status: 'reserved',
        reserved_credits: 0,
        mode: 'shadow',
        message_kind: p.messageKind,
        attribution: p.attribution ?? {},
      });
      return { allow: true, chargeId, mode: 'shadow' };
    }

    const { data: walletData } = await p.admin
      .from('ai_wallets')
      .select('message_rate_credits, grace_overdraft_credits, auto_recharge_enabled')
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    const wallet = walletData as WalletRow | null;

    const tenantRate = wallet?.message_rate_credits != null ? Number(wallet.message_rate_credits) : null;
    const sellCredits = resolveMessageSellCredits(tenantRate);
    const graceCredits = wallet?.grace_overdraft_credits != null
      ? Number(wallet.grace_overdraft_credits)
      : getGraceOverdraftDefault();
    const autoRechargeEnabled = !!wallet?.auto_recharge_enabled;

    const capDecision = await checkCaps(p.admin, p.tenantId);
    if (!capDecision.allowed) {
      return { allow: false, reason: 'handoff' };
    }

    const initialOverdraft = capDecision.degraded ? graceCredits : 0;

    let reserveRes = await callReserveRpc(
      p.admin, p.tenantId, sellCredits, initialOverdraft, p.messageKind, p.attribution,
    );

    if (!reserveRes.allowed && reserveRes.reason === 'insufficient_balance') {
      if (autoRechargeEnabled) {
        const recharged = await attemptAutoRecharge(p.admin, p.tenantId).catch((e) => {
          console.warn('[messageWallet] auto-recharge attempt failed', e);
          return false;
        });
        if (recharged) {
          reserveRes = await callReserveRpc(
            p.admin, p.tenantId, sellCredits, initialOverdraft, p.messageKind, p.attribution,
          );
        }
      }

      if (!reserveRes.allowed) {
        reserveRes = await callReserveRpc(
          p.admin, p.tenantId, sellCredits, graceCredits, p.messageKind, p.attribution,
        );
      }
    }

    if (!reserveRes.allowed || !reserveRes.reservationId) {
      return { allow: false, reason: 'handoff' };
    }

    const mode: ReserveMode = reserveRes.reason === 'reserved_grace' ? 'grace' : 'paid';
    const chargeId = await insertChargeRow(p.admin, {
      tenant_id: p.tenantId,
      provider: p.provider,
      status: 'reserved',
      wallet_reservation_id: reserveRes.reservationId,
      reserved_credits: sellCredits,
      mode: 'live',
      message_kind: p.messageKind,
      attribution: p.attribution ?? {},
    });

    return { allow: true, chargeId, mode };
  } catch (error) {
    // An internal metering fault must never silence a tenant's bot. Booka eats
    // the cost of its own bugs: let the send proceed unbilled and unstuck.
    console.error('[messageWallet] reserveOutboundMessage failed', error);
    return { allow: true, chargeId: null, mode: 'grace' };
  }
}

/**
 * Best-effort attempt to top up a tenant's wallet via their saved Paystack
 * payment method before falling back to the bounded grace overdraft.
 *
 * Not yet wired to a real charge: this codebase has no saved-card auto-debit
 * flow for AI/message wallets today (only one-off checkout charges), and per
 * the dependency-verification rule we do not implement a payment integration
 * without first confirming the exact API against Paystack's current docs.
 * Until that's built, this always reports failure so the caller falls through
 * to the grace-overdraft path — safe because grace is bounded, and refusing
 * silently would violate "never let a metering fault silence the bot".
 */
async function attemptAutoRecharge(_admin: SupabaseClient, _tenantId: string): Promise<boolean> {
  return false;
}

/**
 * Merges an orphan settlement row into the reservation row once the post-send
 * UPDATE lands, handling the race where Meta's status webhook settles a wamid
 * before the send path has attached it.
 */
export async function attachWamid(admin: SupabaseClient, chargeId: string, wamid: string): Promise<void> {
  const { error } = await admin
    .from(CHARGES_TABLE)
    .update({ wamid })
    .eq('id', chargeId);

  if (!error) return;

  if ((error as { code?: string }).code !== '23505') {
    console.warn('[messageWallet] attachWamid failed', error);
    return;
  }

  // Race: settlement already created an orphan row holding this wamid. Merge
  // its pricing/delivery data onto the reserved row, mark it settled, and
  // delete the orphan.
  const { data: reservedData } = await admin
    .from(CHARGES_TABLE)
    .select('id, tenant_id')
    .eq('id', chargeId)
    .maybeSingle();
  const reserved = reservedData as { id: string; tenant_id: string } | null;
  if (!reserved) return;

  const { data: orphanData } = await admin
    .from(CHARGES_TABLE)
    .select('id, billable, pricing_category, pricing_type, pricing_model, delivery_status, settled_credits')
    .eq('tenant_id', reserved.tenant_id)
    .eq('wamid', wamid)
    .maybeSingle();
  const orphan = orphanData as {
    id: string;
    billable?: boolean | null;
    pricing_category?: string | null;
    pricing_type?: string | null;
    pricing_model?: string | null;
    delivery_status?: string | null;
    settled_credits?: number | string | null;
  } | null;
  if (!orphan) return;

  await admin.from(CHARGES_TABLE).delete().eq('id', orphan.id);

  await admin
    .from(CHARGES_TABLE)
    .update({
      wamid,
      billable: orphan.billable ?? null,
      pricing_category: orphan.pricing_category ?? null,
      pricing_type: orphan.pricing_type ?? null,
      pricing_model: orphan.pricing_model ?? null,
      delivery_status: orphan.delivery_status ?? null,
      settled_credits: orphan.settled_credits != null ? Number(orphan.settled_credits) : 0,
      status: 'settled',
      settled_at: new Date().toISOString(),
    })
    .eq('id', chargeId);
}

/**
 * Releases a reservation for a charge that was reserved but will never be
 * settled through the normal delivery-webhook path (e.g. the send was
 * abandoned after reservation succeeded). No-op for free/shadow rows, which
 * never held a wallet reservation.
 */
export async function abandonCharge(admin: SupabaseClient, chargeId: string): Promise<void> {
  const { data } = await admin
    .from(CHARGES_TABLE)
    .select('id, tenant_id, status, reserved_credits, wallet_reservation_id')
    .eq('id', chargeId)
    .maybeSingle();
  const row = data as (ChargeRow & { tenant_id?: string }) | null;
  if (!row) return;
  if (row.status === 'settled' || row.status === 'released') return;

  if (row.wallet_reservation_id && row.tenant_id) {
    await admin.rpc('settle_ai_wallet_spend', {
      p_tenant_id: row.tenant_id,
      p_reservation_id: row.wallet_reservation_id,
      p_estimated_credits: Number(row.reserved_credits ?? 0),
      p_actual_credits: 0,
      p_tokens: null,
      p_provider: 'meta',
      p_model: null,
      p_request_id: null,
      p_metadata: { reason: 'abandoned' },
      p_meter: 'whatsapp',
    });
  }

  await admin
    .from(CHARGES_TABLE)
    .update({ status: 'released', settled_credits: 0, settled_at: new Date().toISOString() })
    .eq('id', chargeId);
}

/**
 * Settles a charge row against Meta's delivery webhook. Handles rows that
 * arrive before the post-send UPDATE (orphan insert), rows with no wallet
 * reservation (free provider / shadow mode — records data but never calls the
 * settle RPC), and replay safety for already-terminal rows.
 */
export async function settleOutboundMessage(p: SettleOutboundParams): Promise<void> {
  const { admin, tenantId, wamid, deliveryStatus, pricing } = p;

  const { data } = await admin
    .from(CHARGES_TABLE)
    .select('id, status, reserved_credits, wallet_reservation_id')
    .eq('tenant_id', tenantId)
    .eq('wamid', wamid)
    .maybeSingle();
  const row = data as ChargeRow | null;

  if (!row) {
    // Meta's webhook arrived before the post-send UPDATE landed. Record an
    // orphan row carrying the pricing data so attachWamid can merge it in.
    await insertChargeRow(admin, {
      tenant_id: tenantId,
      provider: 'meta',
      wamid,
      reserved_credits: 0,
      settled_credits: 0,
      status: 'settled',
      wallet_reservation_id: null,
      billable: deliveryStatus === 'failed' ? false : (pricing?.billable ?? null),
      pricing_category: pricing?.category ?? null,
      pricing_type: pricing?.type ?? null,
      pricing_model: pricing?.pricing_model ?? null,
      delivery_status: deliveryStatus,
      settled_at: new Date().toISOString(),
    });
    return;
  }

  if (row.status === 'settled' || row.status === 'released') {
    // Replay safety: Meta's webhooks can duplicate.
    return;
  }

  if (deliveryStatus === 'sent') {
    await admin.from(CHARGES_TABLE).update({ delivery_status: 'sent' }).eq('id', row.id);
    return;
  }

  const pricingFields = {
    billable: deliveryStatus === 'failed' ? false : (pricing?.billable ?? null),
    pricing_category: pricing?.category ?? null,
    pricing_type: pricing?.type ?? null,
    pricing_model: pricing?.pricing_model ?? null,
    delivery_status: deliveryStatus,
  };

  if (!row.wallet_reservation_id) {
    // Free provider or shadow mode: no reservation to release, but the
    // pricing/delivery data is exactly what shadow mode exists to collect.
    await admin
      .from(CHARGES_TABLE)
      .update({
        ...pricingFields,
        settled_credits: 0,
        status: 'settled',
        settled_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return;
  }

  const reservedCredits = Number(row.reserved_credits ?? 0);
  const billable = deliveryStatus === 'failed' ? false : !!pricing?.billable;
  const settledCredits = billable ? reservedCredits : 0;

  const { data: settleData } = await admin.rpc('settle_ai_wallet_spend', {
    p_tenant_id: tenantId,
    p_reservation_id: row.wallet_reservation_id,
    p_estimated_credits: reservedCredits,
    p_actual_credits: settledCredits,
    p_tokens: null,
    p_provider: 'meta',
    p_model: null,
    p_request_id: wamid,
    p_metadata: { wamid, delivery_status: deliveryStatus },
    p_meter: 'whatsapp',
  });
  // Settlement result isn't branched on: whether or not the RPC reports
  // allowed, the charge row still records the terminal delivery/pricing
  // outcome below — a failed settle RPC should not resurface as a stuck send.
  void (settleData as SettleRpcRow[] | SettleRpcRow | null);

  await admin
    .from(CHARGES_TABLE)
    .update({
      ...pricingFields,
      settled_credits: settledCredits,
      status: deliveryStatus === 'failed' ? 'released' : 'settled',
      settled_at: new Date().toISOString(),
    })
    .eq('id', row.id);
}

/**
 * Sweeps charge rows that were reserved but never received a delivery webhook
 * within `olderThanMs`, releasing each reservation at zero cost. The
 * wallet_reservation_id filter is load-bearing: free-provider and shadow-mode
 * rows are written with status='reserved' and no wallet reservation, and must
 * never be swept — sweeping them would call settle_ai_wallet_spend with a null
 * reservation and permanently inflate the `released` counter, which is the
 * only signal available to detect a broken Meta webhook subscription.
 */
export async function releaseStaleReservations(
  admin: SupabaseClient,
  olderThanMs: number,
): Promise<{ released: number }> {
  const cutoffIso = new Date(Date.now() - olderThanMs).toISOString();

  const { data } = await admin
    .from(CHARGES_TABLE)
    .select('id, tenant_id, reserved_credits, wallet_reservation_id')
    .eq('status', 'reserved')
    .not('wamid', 'is', null)
    .not('wallet_reservation_id', 'is', null)
    .lt('sent_at', cutoffIso);

  const rows = (data ?? []) as Array<ChargeRow & { tenant_id: string }>;
  let released = 0;

  for (const row of rows) {
    if (!row.wallet_reservation_id) continue;

    await admin.rpc('settle_ai_wallet_spend', {
      p_tenant_id: row.tenant_id,
      p_reservation_id: row.wallet_reservation_id,
      p_estimated_credits: Number(row.reserved_credits ?? 0),
      p_actual_credits: 0,
      p_tokens: null,
      p_provider: 'meta',
      p_model: null,
      p_request_id: null,
      p_metadata: { reason: 'stale_reservation_sweep' },
      p_meter: 'whatsapp',
    });

    await admin
      .from(CHARGES_TABLE)
      .update({ status: 'released', settled_credits: 0, settled_at: new Date().toISOString() })
      .eq('id', row.id);

    released += 1;
  }

  return { released };
}
