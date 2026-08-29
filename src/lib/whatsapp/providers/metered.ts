import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  abandonCharge,
  attachWamid,
  reserveOutboundMessage,
  type MessageKind,
} from '@/lib/billing/messageWallet';
import { triggerWalletHandoff } from '@/lib/billing/messageHandoff';
import type {
  InteractiveMessagePayload,
  ProviderSendResult,
  WhatsAppProviderClient,
} from './types';

export interface MeteringOpts {
  tenantId: string;
  provider: string;
  /**
   * Which channel this client sends on. Required because the wallet-exhausted
   * handoff refuses non-WhatsApp channels — the Instagram webhook stores an
   * IGSID in `chats.customer_phone`, so a handoff that assumed WhatsApp would
   * hand those digits to the WhatsApp adapter. The decorator is the only layer
   * that knows which channel a given config is for.
   */
  channel: 'whatsapp' | 'instagram';
}

/**
 * Wraps a provider client so every outbound message reserves wallet credit
 * before it is sent and settles against it afterwards.
 *
 * Non-send methods (session management) pass straight through: they cost
 * nothing and metering them would charge a tenant for reading a QR code.
 */
export function withMetering(
  client: WhatsAppProviderClient,
  opts: MeteringOpts,
): WhatsAppProviderClient {
  async function metered(
    to: string,
    messageKind: MessageKind,
    send: () => Promise<ProviderSendResult>,
  ): Promise<ProviderSendResult> {
    let admin;
    let chargeId: string | null = null;

    try {
      // Built lazily rather than at decoration time: getProviderClient runs on
      // request paths that may never send anything.
      admin = createSupabaseAdminClient();
      const reservation = await reserveOutboundMessage({
        admin,
        tenantId: opts.tenantId,
        provider: opts.provider,
        messageKind,
        attribution: { channel: opts.channel, to },
      });

      if (!reservation.allow) {
        // The wallet cannot fund this reply. Tell the customer a human will
        // follow up rather than going silent, and do NOT send the original.
        await triggerWalletHandoff(admin, opts.tenantId, to, opts.channel);
        return { success: false, reason: 'wallet_exhausted' };
      }

      chargeId = reservation.chargeId;
    } catch (error) {
      // A metering fault must never take a tenant's bot offline. Booka eats the
      // cost of its own bugs: fall through and send unmetered.
      console.error('[metered] reservation failed, sending unmetered', {
        tenantId: opts.tenantId,
        error,
      });
      return send();
    }

    const result = await send();

    try {
      // chargeId is null when Task 7's internal-error fallback let the send
      // proceed without a charge row — there is nothing to attach or abandon.
      if (!chargeId || !admin) return result;
      if (result?.success && result.messageId) {
        await attachWamid(admin, chargeId, result.messageId);
      } else if (!result?.success) {
        await abandonCharge(admin, chargeId);
      }
    } catch (error) {
      // The message already went out. Settlement bookkeeping failing must not
      // turn a delivered message into a reported failure; the sweeper reclaims
      // the reservation.
      console.error('[metered] post-send settlement failed', {
        tenantId: opts.tenantId,
        chargeId,
        error,
      });
    }

    return result;
  }

  return {
    createInstance: (webhookUrl, webhookSecret) => client.createInstance(webhookUrl, webhookSecret),
    getConnectionStatus: () => client.getConnectionStatus(),
    getQrCode: () => client.getQrCode(),
    requestPairingCode: (phoneNumber: string) => client.requestPairingCode(phoneNumber),
    deleteInstance: () => client.deleteInstance(),

    sendTextMessage: (to: string, text: string, quotedMessageId?: string) =>
      metered(to, 'freeform', () => client.sendTextMessage(to, text, quotedMessageId)),

    sendTemplateMessage: client.sendTemplateMessage
      ? (
        to: string,
        templateName: string,
        parameters?: Array<{ default: string }>,
        language?: string,
      ) => metered(to, 'template', () =>
        client.sendTemplateMessage!(to, templateName, parameters, language))
      : undefined,

    sendMediaMessage: (
      to: string,
      media: { url: string; mimetype: string; filename?: string },
      caption?: string,
      type?: 'image' | 'document' | 'audio' | 'video',
    ) => metered(to, 'media', () => client.sendMediaMessage(to, media, caption, type)),

    sendInteractiveMessage: (to: string, payload: InteractiveMessagePayload) =>
      metered(to, 'interactive', () => client.sendInteractiveMessage(to, payload)),
  };
}
