import type { SupabaseClient } from '@supabase/supabase-js';
// Imported from the leaf module, not from providerSelection: providerSelection
// imports the metering factory, and metering imports this file.
import { getTenantWhatsAppProviderClientUnmetered } from '@/lib/whatsapp/providers/unmetered';
import { sendTelegramInfo } from '@/lib/monitoring/telegramAlert';
import { getHandoffRearmHours } from '@/lib/billing/messageRates';

/**
 * Wallet-exhausted handoff: the one message a customer gets when the tenant's
 * message wallet can no longer fund a reply.
 *
 * Three properties are load-bearing:
 *  - it is sent through the *unmetered* provider client (see the call site
 *    comment below);
 *  - it fires at most once per conversation per re-arm window, flagged on
 *    `chats.metadata`. Without the flag every subsequent inbound message
 *    triggers another handoff and the failure mode becomes a loop instead of
 *    a wall; and
 *  - the stamp re-arms, on the clock OR on a wallet credit. `chats` is UNIQUE
 *    on (tenant_id, customer_phone), so one row covers the whole lifetime of
 *    that customer relationship — a permanent stamp would silence that
 *    customer forever after a single exhaustion.
 */

const CHATS_TABLE = 'chats';
const WALLETS_TABLE = 'ai_wallets';
const LEDGER_TABLE = 'ai_wallet_ledger';
const HANDOFF_METADATA_KEY = 'wallet_handoff_at';

/**
 * Ledger kinds that mean "money was added to this wallet".
 * `topup` is what `topup_ai_wallet()` writes; `adjustment` is the manual
 * superadmin credit. `refund` is deliberately excluded: it is an
 * over-reservation being returned at settlement, not new funding, so it must
 * not re-arm the handoff. Spend rows carry a negative `amount_credits`
 * (see spendGuard), hence the `amount_credits > 0` filter as well.
 */
const CREDIT_LEDGER_KINDS = ['topup', 'adjustment'];

const HANDOFF_TEXT =
  'Thanks for your message. Our automated assistant is briefly unavailable, '
  + 'so a member of our team will reply to you here shortly.';

export type WalletHandoffReason =
  | 'sent'
  | 'already_handed_off'
  | 'no_provider'
  | 'unsupported_channel'
  | 'opted_out'
  | 'outside_service_window'
  | 'error';

/**
 * The channel the refused send was for. Explicit rather than inferred from
 * `chats.metadata.channel`: the Instagram webhook writes that key but the
 * WhatsApp webhooks do not, so metadata cannot tell the two apart.
 */
export type WalletHandoffChannel = 'whatsapp' | 'instagram';

export interface WalletHandoffResult {
  sent: boolean;
  // 'error' covers every internal fault (DB read failure, provider throw,
  // refused send). This function sits on the inbound message path, so it
  // never throws — a metering/notification fault must not take a tenant's
  // bot offline. `sent: false` is the only claim a caller may act on.
  reason: WalletHandoffReason;
}

type ChatRow = {
  id: string;
  metadata?: Record<string, unknown> | null;
};

type WalletMarkers = {
  warnedOn: string | null;
  unanchoredOn: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Has this wallet been credited since `sinceIso`? A top-up between the stamp
 * and now means the tenant can fund replies again, so the conversation must be
 * allowed another handoff when the wallet empties a second time — the clock
 * alone is not enough (exhaust 09:00 → top up 10:00 → re-exhaust 15:00 leaves
 * a six-hour-old stamp).
 *
 * On a read error this returns false — "no credit found" — which leaves the
 * clock re-arm as the only path. Silence stays bounded by the re-arm window
 * rather than becoming permanent.
 */
async function hasWalletCreditSince(
  admin: SupabaseClient,
  tenantId: string,
  sinceIso: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from(LEDGER_TABLE)
    .select('id')
    .eq('tenant_id', tenantId)
    .in('kind', CREDIT_LEDGER_KINDS)
    .gt('amount_credits', 0)
    .gt('created_at', sinceIso)
    .limit(1);

  if (error) {
    console.warn('[messageHandoff] wallet credit check failed, falling back to the clock', {
      tenantId,
      error,
    });
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * Is the existing handoff stamp still silencing this conversation?
 *
 * Re-arms on `clock OR wallet credit`. Fails toward re-arming: an absent or
 * unparseable stamp is treated as stale. `new Date(garbage).getTime()` is NaN
 * and `NaN < cutoff` is false, so the naive comparison would read garbage as
 * "recent" and silence the conversation permanently.
 */
async function isHandoffStampActive(
  admin: SupabaseClient,
  tenantId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const raw = metadata[HANDOFF_METADATA_KEY];
  const stampedMs = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(stampedMs)) {
    return false;
  }

  const cutoffMs = Date.now() - getHandoffRearmHours() * 60 * 60 * 1000;
  if (stampedMs <= cutoffMs) {
    return false;
  }

  return !(await hasWalletCreditSince(admin, tenantId, new Date(stampedMs).toISOString()));
}

async function readWalletMarkers(admin: SupabaseClient, tenantId: string): Promise<WalletMarkers> {
  const { data, error } = await admin
    .from(WALLETS_TABLE)
    .select('message_handoff_warned_on, message_handoff_unanchored_on')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error && (error as { code?: string }).code !== 'PGRST116') {
    console.warn('[messageHandoff] failed to read wallet handoff markers', { tenantId, error });
    return { warnedOn: null, unanchoredOn: null };
  }

  const row = (data ?? null) as {
    message_handoff_warned_on?: string | null;
    message_handoff_unanchored_on?: string | null;
  } | null;

  return {
    warnedOn: row?.message_handoff_warned_on ?? null,
    unanchoredOn: row?.message_handoff_unanchored_on ?? null,
  };
}

/**
 * Writes the once-per-conversation stamp. Returns false when nothing was
 * stamped — including the zero-row match, which Supabase reports as
 * `error: null` and which would otherwise be read as success.
 */
async function stampChat(
  admin: SupabaseClient,
  tenantId: string,
  chatId: string,
  stampedAt: string,
): Promise<boolean> {
  // Re-read metadata immediately before the write. `chats.metadata` is shared
  // (journey-service writes `journey`, chats/[id] writes `support`,
  // summarizerWorker writes `summary`), and merging onto the copy read before
  // the provider send would clobber anything written during that round-trip —
  // an agent assignment made in response to this very handoff, for instance.
  // The remaining window is the gap between these two adjacent statements: a
  // writer landing there still loses. Closing it needs a jsonb_set RPC, which
  // needs a migration, so it is out of scope here.
  const { data: fresh, error: reReadErr } = await admin
    .from(CHATS_TABLE)
    .select('metadata')
    .eq('id', chatId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (reReadErr) {
    console.error('[messageHandoff] could not re-read chat metadata before stamping', {
      tenantId,
      chatId,
      reReadErr,
    });
    return false;
  }

  const base = ((fresh as ChatRow | null)?.metadata ?? {}) as Record<string, unknown>;

  const { data, error } = await admin
    .from(CHATS_TABLE)
    .update({ metadata: { ...base, [HANDOFF_METADATA_KEY]: stampedAt } })
    .eq('id', chatId)
    .eq('tenant_id', tenantId)
    .select('id');

  if (error) {
    console.error('[messageHandoff] handoff stamp update failed', { tenantId, chatId, error });
    return false;
  }

  const rows = (data ?? []) as unknown[];
  if (rows.length === 0) {
    // Zero rows matched and Supabase reported no error: the row vanished, or a
    // policy filtered the update. Nothing was stamped.
    console.error('[messageHandoff] handoff stamp matched no rows', { tenantId, chatId });
    return false;
  }

  return true;
}

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The two conversation-level reasons not to send a handoff, read in ONE query
 * because they live in the same row.
 *
 *  - `optedOut`: this send bypasses sendGovernedInitiated, so this is the only
 *    opt-out guard on the path.
 *  - `outsideServiceWindow`: the handoff is free-form text, which Meta permits
 *    only within 24h of the customer's last inbound message. Today that holds
 *    implicitly — a handoff needs a `chats` row and only inbound conversations
 *    have one — but that is a coincidence of the current call graph, not a
 *    check. Outside the window Meta rejects the send anyway, so asserting it
 *    costs nothing and turns a confusing provider error into a clear skip.
 *
 * Both fail toward SENDING on a read error: a broken lookup must not silently
 * kill a feature the tenant depends on. A real opt-out or a real stale window
 * always wins.
 */
async function readConversationGuards(
  admin: SupabaseClient,
  tenantId: string,
  toNumber: string,
): Promise<{ optedOut: boolean; outsideServiceWindow: boolean }> {
  const { data, error } = await admin
    .from('whatsapp_conversations')
    .select('opted_out_at, last_inbound_at')
    .eq('tenant_id', tenantId)
    .eq('phone_number', toNumber)
    .maybeSingle();

  if (error) {
    console.warn('[messageHandoff] conversation guard lookup failed, proceeding', { tenantId, error });
    return { optedOut: false, outsideServiceWindow: false };
  }

  const row = data as { opted_out_at?: string | null; last_inbound_at?: string | null } | null;
  if (!row) return { optedOut: false, outsideServiceWindow: false };

  const lastInboundMs = row.last_inbound_at ? Date.parse(row.last_inbound_at) : Number.NaN;
  return {
    optedOut: !!row.opted_out_at,
    // An unparseable or missing timestamp is treated as in-window, consistent
    // with failing toward sending. Only a timestamp we can read AND that is
    // genuinely stale blocks the send.
    outsideServiceWindow: Number.isFinite(lastInboundMs)
      && Date.now() - lastInboundMs > SERVICE_WINDOW_MS,
  };
}

/**
 * Sends the wallet-exhausted handoff message for one conversation, at most
 * once per re-arm window. Never throws.
 */
export async function triggerWalletHandoff(
  admin: SupabaseClient,
  tenantId: string,
  toNumber: string,
  channel: WalletHandoffChannel,
): Promise<WalletHandoffResult> {
  try {
    if (channel !== 'whatsapp') {
      // The Instagram webhook upserts `chats` with customer_phone = <IGSID>,
      // so the lookup below would SUCCEED for Instagram and hand a 17-digit
      // IGSID to the WhatsApp adapter as a phone number. Beyond being wrong,
      // that upsert also overwrites `metadata` wholesale on every inbound
      // message, so the once-per-conversation stamp cannot survive on an
      // Instagram chat and the handoff would loop. Skip instead.
      console.warn('[messageHandoff] no handoff path for this channel, skipping', {
        tenantId,
        channel,
      });
      return { sent: false, reason: 'unsupported_channel' };
    }

    const { data, error } = await admin
      .from(CHATS_TABLE)
      .select('id, metadata')
      .eq('tenant_id', tenantId)
      .eq('customer_phone', toNumber)
      .maybeSingle();

    if (error) {
      console.error('[messageHandoff] failed to load chat row, not sending', { tenantId, error });
      return { sent: false, reason: 'error' };
    }

    const chat = data as ChatRow | null;
    if (!chat) {
      // No chat row means no place to record the once-per-conversation stamp,
      // and sending anyway would hand off again on every subsequent inbound
      // message — the exact loop this module exists to prevent. Inbound
      // conversations always have a row (the webhook upserts one before any
      // reply is attempted); outbound-initiated sends, whose number comes from
      // `bookings` or `leads`, legitimately do not, so this is a normal
      // outcome for campaign traffic and not an alarm.
      console.warn('[messageHandoff] no chat row for handoff, refusing to send unanchored', {
        tenantId,
      });
      return { sent: false, reason: 'error' };
    }

    // COMPLIANCE: never hand off to someone who has unsubscribed. This send
    // goes through the unmetered client, which bypasses sendGovernedInitiated's
    // opt-out checks entirely, so this is the only place that guard exists on
    // this path. The sharpest case is a customer texting STOP into an exhausted
    // wallet: without this they would be told a human will follow up, moments
    // after asking not to be contacted.
    const guards = await readConversationGuards(admin, tenantId, toNumber);
    if (guards.optedOut) {
      console.warn('[messageHandoff] suppressed: customer has opted out', { tenantId });
      return { sent: false, reason: 'opted_out' };
    }
    if (guards.outsideServiceWindow) {
      console.warn('[messageHandoff] suppressed: outside the 24h service window', { tenantId });
      return { sent: false, reason: 'outside_service_window' };
    }

    const metadata = (chat.metadata ?? {}) as Record<string, unknown>;
    if (await isHandoffStampActive(admin, tenantId, metadata)) {
      return { sent: false, reason: 'already_handed_off' };
    }

    // One read, two gates. Read before the send so the ceiling below can
    // suppress it. Two concurrent handoffs can both observe a null marker and
    // both alert; that is the same benign race spendAlerts carries.
    const today = todayIsoDate();
    const markers = await readWalletMarkers(admin, tenantId);

    if (markers.unanchoredOn === today) {
      // A handoff already went out today that could not be stamped, so the
      // per-conversation guard is not working for this tenant. Ceiling: one
      // platform-funded send per tenant per day rather than one per inbound
      // message.
      console.warn('[messageHandoff] handoff suppressed: stamping is failing for this tenant', {
        tenantId,
      });
      return { sent: false, reason: 'already_handed_off' };
    }

    // RECURSION HAZARD: this must be the *unmetered* client. The metered
    // client re-enters reserveOutboundMessage, which fails again (the wallet
    // is empty — that is why we are here) and calls triggerWalletHandoff
    // again, and so on. The handoff message is deliberately platform-funded.
    const client = await getTenantWhatsAppProviderClientUnmetered(tenantId);
    if (!client) {
      return { sent: false, reason: 'no_provider' };
    }

    const result = await client.sendTextMessage(toNumber, HANDOFF_TEXT);
    if (!result?.success) {
      // Do not stamp: nothing reached the customer, so the next inbound
      // message should get another chance at a handoff.
      console.warn('[messageHandoff] handoff send refused by provider', {
        tenantId,
        reason: result?.reason,
      });
      return { sent: false, reason: 'error' };
    }

    const stamped = await stampChat(admin, tenantId, chat.id, new Date().toISOString());
    if (!stamped) {
      // The message went out but the guard did not land: without a ceiling the
      // next inbound message from this customer would hand off again, and
      // again. Mark the tenant-day instead, which the gate above reads.
      console.error(
        '[messageHandoff] handoff sent but stamp failed — capping this tenant at one handoff today',
        { tenantId, chatId: chat.id },
      );
      await markHandoffUnanchored(admin, tenantId, today);
    }

    await persistHandoffMessage(admin, tenantId, chat.id, toNumber, result.messageId);
    await notifyOwner(admin, tenantId, toNumber, markers.warnedOn, today);

    return { sent: true, reason: 'sent' };
  } catch (error) {
    console.error('[messageHandoff] triggerWalletHandoff failed', { tenantId, error });
    return { sent: false, reason: 'error' };
  }
}

/**
 * Records the handoff in the conversation thread.
 *
 * This message is sent outside the normal reply path, which is the only place
 * outbound messages are persisted — so without this the customer sees "a member
 * of our team will reply to you here shortly" while staff open the chat and see
 * an inbound message with no reply at all. That is exactly the moment a human is
 * being asked to take over, so they need to know what was already promised.
 *
 * Best-effort: a failed insert must not turn a delivered handoff into a
 * reported failure.
 */
async function persistHandoffMessage(
  admin: SupabaseClient,
  tenantId: string,
  chatId: string,
  toNumber: string,
  messageId?: string,
): Promise<void> {
  try {
    const { error } = await admin.from('messages').insert({
      tenant_id: tenantId,
      chat_id: chatId,
      to_number: toNumber,
      content: HANDOFF_TEXT,
      direction: 'outbound',
      message_type: 'text',
      channel: 'whatsapp',
      evolution_message_id: messageId ?? null,
      timestamp: new Date().toISOString(),
    });
    if (error) {
      console.warn('[messageHandoff] handoff sent but not recorded in the thread', {
        tenantId,
        chatId,
        error,
      });
    }
  } catch (error) {
    console.warn('[messageHandoff] failed to persist the handoff message', { tenantId, error });
  }
}

async function markHandoffUnanchored(
  admin: SupabaseClient,
  tenantId: string,
  today: string,
): Promise<void> {
  try {
    // Checked, not fire-and-forget: supabase-js resolves with an `error` rather
    // than throwing, so an unchecked call would swallow the one write that
    // bounds a broken-stamp loop. If this fails too, the loop is unbounded
    // again — say so loudly rather than leaving it silent.
    const { error } = await admin
      .from(WALLETS_TABLE)
      .upsert({ tenant_id: tenantId, message_handoff_unanchored_on: today }, { onConflict: 'tenant_id' });
    if (error) {
      console.error(
        '[messageHandoff] could not record the unanchored-handoff ceiling — handoffs stay uncapped for this tenant',
        { tenantId, error },
      );
    }
  } catch (error) {
    console.error('[messageHandoff] failed to record the unanchored-handoff ceiling', {
      tenantId,
      error,
    });
  }
}

/**
 * Tells the tenant their wallet is empty: a `notifications` row on their
 * dashboard, plus a line of ops telemetry to Booka's own Telegram channel
 * (process-level TELEGRAM_CHAT_ID — not the tenant's).
 *
 * Capped at one per tenant per day via `ai_wallets.message_handoff_warned_on`:
 * one exhaustion refuses a send in every live conversation, so without the cap
 * a tenant with 50 open chats gets 50 notifications and 50 Telegram pings.
 *
 * Best-effort: a failed notification must never turn a delivered handoff into
 * a reported failure.
 */
async function notifyOwner(
  admin: SupabaseClient,
  tenantId: string,
  toNumber: string,
  warnedOn: string | null,
  today: string,
): Promise<void> {
  try {
    if (warnedOn === today) {
      return;
    }

    // notifications columns are: tenant_id, title, message, meta, read (NO type/body/metadata).
    await admin.from('notifications').insert({
      tenant_id: tenantId,
      title: 'Message wallet empty — replies paused',
      message:
        'Your message wallet is out of credit, so the assistant has told this customer '
        + 'a team member will follow up. Top up to resume automated replies.',
      meta: { kind: 'wallet_handoff', customer_phone: toNumber },
      read: false,
    });

    const { error: markErr } = await admin
      .from(WALLETS_TABLE)
      .upsert({ tenant_id: tenantId, message_handoff_warned_on: today }, { onConflict: 'tenant_id' });
    if (markErr) {
      // The day marker is the only thing standing between one alert and one
      // per live conversation, so a silent failure here is the storm coming
      // back with nothing in the logs to explain it.
      console.error('[messageHandoff] owner alert sent but the day marker failed — alerts may repeat today', {
        tenantId,
        markErr,
      });
    }

    await sendTelegramInfo(`Message wallet exhausted — handoff sent for tenant ${tenantId}.`);
  } catch (error) {
    console.warn('[messageHandoff] failed to emit owner alert', error);
  }
}
