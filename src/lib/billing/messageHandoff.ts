import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantWhatsAppProviderClientUnmetered } from '@/lib/whatsapp/providers/providerSelection';
import { sendTelegramInfo } from '@/lib/monitoring/telegramAlert';

/**
 * Wallet-exhausted handoff: the one message a customer gets when the tenant's
 * message wallet can no longer fund a reply.
 *
 * Two properties are load-bearing:
 *  - it is sent through the *unmetered* provider client (see the call site
 *    comment below), and
 *  - it fires at most once per conversation, flagged on `chats.metadata`.
 *    Without the flag every subsequent inbound message triggers another
 *    handoff and the failure mode becomes a loop instead of a wall.
 */

const CHATS_TABLE = 'chats';
const HANDOFF_METADATA_KEY = 'wallet_handoff_at';

const HANDOFF_TEXT =
  'Thanks for your message. Our automated assistant is briefly unavailable, '
  + 'so a member of our team will reply to you here shortly.';

export type WalletHandoffReason = 'sent' | 'already_handed_off' | 'no_provider' | 'error';

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

/**
 * Sends the wallet-exhausted handoff message for one conversation, at most
 * once. Never throws.
 */
export async function triggerWalletHandoff(
  admin: SupabaseClient,
  tenantId: string,
  toNumber: string,
): Promise<WalletHandoffResult> {
  try {
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
      // No chat row means no place to record the once-per-conversation stamp.
      // Sending anyway would hand off again on every subsequent inbound
      // message — the exact loop this module exists to prevent — so refuse.
      // (The inbound webhook upserts the chat before any reply is attempted,
      // so this is a "something is badly wrong" path, not a normal one.)
      console.error('[messageHandoff] no chat row for handoff, refusing to send unanchored', {
        tenantId,
      });
      return { sent: false, reason: 'error' };
    }

    const metadata = (chat.metadata ?? {}) as Record<string, unknown>;
    if (metadata[HANDOFF_METADATA_KEY]) {
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

    const stampedAt = new Date().toISOString();
    // Read-modify-write on a JSONB blob: a concurrent metadata write between
    // the select above and this update would be clobbered. Accepted here —
    // the alternative (a jsonb_set RPC) needs a migration, which is out of
    // scope for this task.
    const { error: stampErr } = await admin
      .from(CHATS_TABLE)
      .update({ metadata: { ...metadata, [HANDOFF_METADATA_KEY]: stampedAt } })
      .eq('id', chat.id);
    if (stampErr) {
      // The message went out but the guard did not land: the next inbound
      // message will hand off again. Loud, because it is the loop condition.
      console.error(
        '[messageHandoff] handoff sent but stamp failed — handoff may repeat for this conversation',
        { tenantId, chatId: chat.id, stampErr },
      );
    }

    await notifyOwner(admin, tenantId, toNumber);

    return { sent: true, reason: 'sent' };
  } catch (error) {
    console.error('[messageHandoff] triggerWalletHandoff failed', { tenantId, error });
    return { sent: false, reason: 'error' };
  }
}

/**
 * Urgent owner alert. Best-effort: a failed notification must never turn a
 * delivered handoff into a reported failure.
 */
async function notifyOwner(admin: SupabaseClient, tenantId: string, toNumber: string): Promise<void> {
  try {
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

    await sendTelegramInfo(`Message wallet exhausted — handoff sent for tenant ${tenantId}.`);
  } catch (error) {
    console.warn('[messageHandoff] failed to emit owner alert', error);
  }
}
