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
  // chargeId is null when no charge row exists to correlate: either the
  // internal-error fallback below, or a post-reservation insert failure that
  // was released back to the wallet. Callers must null-check before calling
  // attachWamid.
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

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Coerces a NUMERIC column (arrives from PostgREST as a string) into a
 * finite number, or returns null and logs loudly. Never let a malformed
 * value silently become NaN and drift into money math or a JSON payload
 * (NaN serializes to `null`, which the RPC would read as `invalid_amount`
 * while the caller has already marked the row settled).
 */
function safeCredits(value: unknown, context: string): number | null {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    console.error(`[messageWallet] ${context}: reserved_credits is not a finite number`, { value });
    return null;
  }
  return n;
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

/**
 * Atomically claims a row for a state transition: only succeeds if the row
 * is still `status='reserved'` at the moment the UPDATE runs. This is the
 * concurrency guard for every money-moving transition (settle, release,
 * abandon) — without it, two deliveries racing for the same wamid (e.g.
 * `delivered` and `read` arriving together) would both pass a plain read
 * check and both call the settle RPC, which is not idempotent and would
 * double the wallet adjustment.
 */
async function claimReservedRow(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ claimed: boolean; error: unknown }> {
  const { data, error } = await admin
    .from(CHARGES_TABLE)
    .update(patch)
    .eq('id', id)
    .eq('status', 'reserved')
    .select('id');
  if (error) return { claimed: false, error };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { claimed: rows.length > 0, error: null };
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
    // A transport/RPC failure is not the wallet declining the spend — it is
    // metering itself being broken. Throw so the caller's try/catch routes
    // this into the safe grace fallback instead of the retry ladder, which
    // only knows how to interpret a genuine 'insufficient_balance' decision.
    throw new Error(`reserve_ai_wallet_spend RPC failed: ${error.message}`);
  }

  const row = firstRow<ReserveRpcRow>(data);
  return {
    allowed: !!row?.allowed,
    reservationId: row?.reservation_id ?? null,
    reason: row?.reason ?? null,
  };
}

/**
 * Settles (or releases, at zero) a wallet reservation. Every call site
 * passes p_meter: 'whatsapp'. Errors are reported structurally rather than
 * thrown — every caller treats "RPC transport error" and "RPC declined the
 * settlement" identically: leave the charge row sweepable rather than mark
 * it terminal with an amount that was never actually moved.
 */
async function callSettleRpc(
  admin: SupabaseClient,
  params: {
    tenantId: string;
    reservationId: string;
    estimatedCredits: number;
    actualCredits: number;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ allowed: boolean; reason: string | null }> {
  const { data, error } = await admin.rpc('settle_ai_wallet_spend', {
    p_tenant_id: params.tenantId,
    p_reservation_id: params.reservationId,
    p_estimated_credits: params.estimatedCredits,
    p_actual_credits: params.actualCredits,
    p_tokens: null,
    p_provider: 'meta',
    p_model: null,
    p_request_id: params.requestId ?? null,
    p_metadata: params.metadata ?? {},
    p_meter: 'whatsapp',
  });

  if (error) {
    return { allowed: false, reason: error.message ?? 'settle_rpc_error' };
  }

  const row = firstRow<SettleRpcRow>(data);
  return { allowed: !!row?.allowed, reason: row?.allowed ? null : (row?.reason ?? 'settle_refused') };
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
        // TODO: stub — always returns false (see attemptAutoRecharge doc comment).
        const recharged = await attemptAutoRecharge().catch((e) => {
          console.warn('[messageWallet] auto-recharge attempt threw', e);
          return false;
        });
        if (recharged) {
          reserveRes = await callReserveRpc(
            p.admin, p.tenantId, sellCredits, initialOverdraft, p.messageKind, p.attribution,
          );
        } else {
          // The only operational signal that auto-recharge exists and did
          // nothing — without this, a tenant with it enabled silently
          // overdrafts into grace with no trace anywhere.
          console.warn('[messageWallet] auto-recharge did not succeed, falling back to grace overdraft', {
            tenantId: p.tenantId,
          });
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

    if (!chargeId) {
      // The reservation succeeded and already debited the balance, but there
      // is now no row anywhere referencing it: the sweeper scans
      // whatsapp_message_charges and will never find it, and abandonCharge
      // needs a chargeId that doesn't exist. Release it back rather than
      // strand it invisibly.
      console.error(
        '[messageWallet] reserveOutboundMessage: charge row insert failed after a successful reservation — releasing to avoid stranding credits',
        { tenantId: p.tenantId, reservationId: reserveRes.reservationId },
      );
      const release = await callSettleRpc(p.admin, {
        tenantId: p.tenantId,
        reservationId: reserveRes.reservationId,
        estimatedCredits: sellCredits,
        actualCredits: 0,
        metadata: { reason: 'charge_row_insert_failed' },
      });
      if (!release.allowed) {
        console.error(
          '[messageWallet] reserveOutboundMessage: release-after-insert-failure also failed — credits may be stranded, needs manual reconciliation',
          { tenantId: p.tenantId, reservationId: reserveRes.reservationId, reason: release.reason },
        );
      }
      return { allow: true, chargeId: null, mode };
    }

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
async function attemptAutoRecharge(): Promise<boolean> {
  return false;
}

/**
 * Merges an orphan settlement row into the reservation row once the post-send
 * UPDATE lands, handling the race where Meta's status webhook settles a wamid
 * before the send path has attached it.
 *
 * The orphan is written by settleOutboundMessage's no-row branch, which has
 * no reservation id and so always records settled_credits: 0 without calling
 * the settle RPC. reserve_ai_wallet_spend has *already* debited the balance
 * for the reserved row's reservation, so the orphan's 0 must never be copied
 * over it — that would strand the debit permanently (the row becomes
 * terminal, so the sweeper, which only looks at status='reserved', can never
 * rescue it). The merge instead settles the real reservation for the actual
 * amount and only then finalizes the row.
 *
 * Known residual risk: this is two separate statements (delete, then
 * update), not one atomic transaction — supabase-js/PostgREST doesn't expose
 * multi-statement client transactions, and building a dedicated merge RPC is
 * out of scope for this fix (it would need its own migration, validated
 * against a live Postgres, which this change doesn't include). Both steps'
 * errors are checked and every failure path logs loudly for manual
 * reconciliation rather than silently reporting success.
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

  const { data: reservedData, error: reservedErr } = await admin
    .from(CHARGES_TABLE)
    .select('id, tenant_id, wallet_reservation_id, reserved_credits')
    .eq('id', chargeId)
    .maybeSingle();
  if (reservedErr) {
    console.error('[messageWallet] attachWamid: failed to load reserved row for merge', reservedErr);
    return;
  }
  const reserved = reservedData as {
    id: string;
    tenant_id: string;
    wallet_reservation_id: string | null;
    reserved_credits: number | string | null;
  } | null;
  if (!reserved) return;

  const { data: orphanData, error: orphanErr } = await admin
    .from(CHARGES_TABLE)
    .select('id, billable, pricing_category, pricing_type, pricing_model, delivery_status')
    .eq('tenant_id', reserved.tenant_id)
    .eq('wamid', wamid)
    .maybeSingle();
  if (orphanErr) {
    console.error('[messageWallet] attachWamid: failed to load orphan for merge', orphanErr);
    return;
  }
  const orphan = orphanData as {
    id: string;
    billable?: boolean | null;
    pricing_category?: string | null;
    pricing_type?: string | null;
    pricing_model?: string | null;
    delivery_status?: string | null;
  } | null;
  if (!orphan) return;

  const reservedCredits = safeCredits(reserved.reserved_credits, 'attachWamid');
  if (reservedCredits === null) return;
  const actualCredits = orphan.billable ? reservedCredits : 0;

  // The unique index means the orphan's wamid must be freed before the
  // reserved row can take it — the delete has to run first. Both this and
  // the final update are checked below: a failure must not silently look
  // like a successful merge.
  const { error: deleteErr } = await admin.from(CHARGES_TABLE).delete().eq('id', orphan.id);
  if (deleteErr) {
    console.error('[messageWallet] attachWamid: orphan delete failed, merge aborted', deleteErr);
    return;
  }

  let settledCredits = 0;
  if (reserved.wallet_reservation_id) {
    const settleResult = await callSettleRpc(admin, {
      tenantId: reserved.tenant_id,
      reservationId: reserved.wallet_reservation_id,
      estimatedCredits: reservedCredits,
      actualCredits,
      requestId: wamid,
      metadata: { wamid, source: 'attachWamid_orphan_merge' },
    });
    if (!settleResult.allowed) {
      // Money did not move. The orphan's pricing data is gone now (Meta will
      // not re-send it) — this needs a human, not a silently "settled" row
      // carrying a fabricated amount.
      console.error(
        '[messageWallet] attachWamid: settle failed after orphan delete — reservation left open, needs manual reconciliation',
        { chargeId, wamid, reason: settleResult.reason },
      );
      return;
    }
    settledCredits = actualCredits;
  }

  const { error: updateErr } = await admin
    .from(CHARGES_TABLE)
    .update({
      wamid,
      billable: orphan.billable ?? null,
      pricing_category: orphan.pricing_category ?? null,
      pricing_type: orphan.pricing_type ?? null,
      pricing_model: orphan.pricing_model ?? null,
      delivery_status: orphan.delivery_status ?? null,
      settled_credits: settledCredits,
      status: 'settled',
      settled_at: nowIso(),
    })
    .eq('id', chargeId);
  if (updateErr) {
    console.error(
      '[messageWallet] attachWamid: final row update failed after settle — wallet balance is correct, charge row needs manual reconciliation',
      { chargeId, wamid, updateErr },
    );
  }
}

/**
 * Releases a reservation for a charge that was reserved but will never be
 * settled through the normal delivery-webhook path (e.g. the send was
 * abandoned after reservation succeeded). No-op for free/shadow rows, which
 * never held a wallet reservation.
 */
export async function abandonCharge(admin: SupabaseClient, chargeId: string): Promise<void> {
  const { data, error } = await admin
    .from(CHARGES_TABLE)
    .select('id, tenant_id, status, reserved_credits, wallet_reservation_id')
    .eq('id', chargeId)
    .maybeSingle();
  if (error) {
    console.error('[messageWallet] abandonCharge: failed to load charge row', error);
    return;
  }
  const row = data as (ChargeRow & { tenant_id?: string }) | null;
  if (!row) return;
  if (row.status === 'settled' || row.status === 'released') return;

  if (!row.wallet_reservation_id || !row.tenant_id) {
    // Free provider or shadow mode: nothing was reserved, so no RPC and no
    // concurrency guard is needed — just finalize.
    await admin
      .from(CHARGES_TABLE)
      .update({ status: 'released', settled_credits: 0, settled_at: nowIso() })
      .eq('id', chargeId)
      .eq('status', 'reserved');
    return;
  }

  const reservedCredits = safeCredits(row.reserved_credits, 'abandonCharge');
  if (reservedCredits === null) return;

  const claim = await claimReservedRow(admin, chargeId, {
    status: 'released',
    settled_credits: 0,
    settled_at: nowIso(),
  });
  if (claim.error) {
    console.error('[messageWallet] abandonCharge: claim update failed', claim.error);
    return;
  }
  if (!claim.claimed) return; // already settled/released/attached concurrently

  const settleResult = await callSettleRpc(admin, {
    tenantId: row.tenant_id,
    reservationId: row.wallet_reservation_id,
    estimatedCredits: reservedCredits,
    actualCredits: 0,
    metadata: { reason: 'abandoned' },
  });
  if (!settleResult.allowed) {
    // Revert the claim: leave the row status='reserved' so it stays
    // sweepable instead of terminal with money that never actually moved.
    console.error(
      '[messageWallet] abandonCharge: settle RPC failed after claim, reverting to reserved',
      { chargeId, reason: settleResult.reason },
    );
    await admin.from(CHARGES_TABLE).update({ status: 'reserved' }).eq('id', chargeId);
  }
}

/**
 * Settles a charge row against Meta's delivery webhook. Handles rows that
 * arrive before the post-send UPDATE (orphan insert), rows with no wallet
 * reservation (free provider / shadow mode — records data but never calls the
 * settle RPC), and replay safety for already-terminal rows.
 */
export async function settleOutboundMessage(p: SettleOutboundParams): Promise<void> {
  const { admin, tenantId, wamid, deliveryStatus, pricing } = p;

  const { data, error: selectErr } = await admin
    .from(CHARGES_TABLE)
    .select('id, status, reserved_credits, wallet_reservation_id')
    .eq('tenant_id', tenantId)
    .eq('wamid', wamid)
    .maybeSingle();
  if (selectErr) {
    // A failed read must not be treated as "no row" — that would insert an
    // orphan on top of a live reserved row and lose the settlement to the
    // unique index instead of merging with it.
    console.error('[messageWallet] settleOutboundMessage: failed to load charge row, aborting', selectErr);
    return;
  }
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
      mode: isShadowMode() ? 'shadow' : 'live',
      billable: deliveryStatus === 'failed' ? false : (pricing?.billable ?? null),
      pricing_category: pricing?.category ?? null,
      pricing_type: pricing?.type ?? null,
      pricing_model: pricing?.pricing_model ?? null,
      delivery_status: deliveryStatus,
      settled_at: nowIso(),
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
    // No money moves here, so no concurrency guard is needed.
    await admin
      .from(CHARGES_TABLE)
      .update({
        ...pricingFields,
        settled_credits: 0,
        status: 'settled',
        settled_at: nowIso(),
      })
      .eq('id', row.id);
    return;
  }

  const reservedCredits = safeCredits(row.reserved_credits, 'settleOutboundMessage');
  if (reservedCredits === null) return;
  const billable = deliveryStatus === 'failed' ? false : !!pricing?.billable;
  const settledCredits = billable ? reservedCredits : 0;
  const targetStatus = deliveryStatus === 'failed' ? 'released' : 'settled';

  // Claim the row before moving money: only proceed if this call is the one
  // that flips status away from 'reserved'. Guards against `delivered` and
  // `read` (or a duplicate webhook) racing for the same wamid and both
  // calling the non-idempotent settle RPC.
  const claim = await claimReservedRow(admin, row.id, {
    ...pricingFields,
    settled_credits: settledCredits,
    status: targetStatus,
    settled_at: nowIso(),
  });
  if (claim.error) {
    console.error('[messageWallet] settleOutboundMessage: claim update failed', claim.error);
    return;
  }
  if (!claim.claimed) {
    // Lost the race to a concurrent settle for the same row.
    return;
  }

  const settleResult = await callSettleRpc(admin, {
    tenantId,
    reservationId: row.wallet_reservation_id,
    estimatedCredits: reservedCredits,
    actualCredits: settledCredits,
    requestId: wamid,
    metadata: { wamid, delivery_status: deliveryStatus },
  });

  if (!settleResult.allowed) {
    // Money did not move. Revert the claim so the row stays 'reserved' and
    // the sweeper can retry it, instead of leaving it terminal with a
    // recorded charge that never happened.
    console.error(
      '[messageWallet] settleOutboundMessage: settle RPC failed after claim, reverting to reserved',
      { wamid, reason: settleResult.reason },
    );
    await admin.from(CHARGES_TABLE).update({ status: 'reserved' }).eq('id', row.id);
  }
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

    const reservedCredits = safeCredits(row.reserved_credits, 'releaseStaleReservations');
    if (reservedCredits === null) continue;

    // Claim before settling: the sweep query and this per-row update are not
    // in the same transaction, so a webhook could settle the row in that
    // window. Only the call that wins the claim gets to call the RPC.
    const claim = await claimReservedRow(admin, row.id, {
      status: 'released',
      settled_credits: 0,
      settled_at: nowIso(),
    });
    if (claim.error) {
      console.error('[messageWallet] releaseStaleReservations: claim failed', claim.error);
      continue;
    }
    if (!claim.claimed) continue; // settled/attached concurrently since the sweep query ran

    const settleResult = await callSettleRpc(admin, {
      tenantId: row.tenant_id,
      reservationId: row.wallet_reservation_id,
      estimatedCredits: reservedCredits,
      actualCredits: 0,
      metadata: { reason: 'stale_reservation_sweep' },
    });

    if (!settleResult.allowed) {
      console.error(
        '[messageWallet] releaseStaleReservations: settle RPC failed after claim, reverting to reserved',
        { chargeId: row.id, reason: settleResult.reason },
      );
      await admin.from(CHARGES_TABLE).update({ status: 'reserved' }).eq('id', row.id);
      continue;
    }

    released += 1;
  }

  return { released };
}
