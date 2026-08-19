import type { SupabaseClient } from '@supabase/supabase-js';
import { hasMessagingConsent } from '@/lib/optin/messagingConsent';
import { CFG } from '@/lib/whatsapp/v2/deliverability/config';

export type ChatChannel = 'whatsapp' | 'instagram';

export type OutboundMode =
  | 'reply_window'
  | 'consented_followup'
  | 'blocked_instagram_window'
  | 'blocked_consent_required';

export interface OutboundReadiness {
  allowed: boolean;
  mode: OutboundMode;
  reason: string;
  lastInboundAt: string | null;
}

export function instagramReplyWindowMs(): number {
  const hours = Number(process.env.META_SERVICE_WINDOW_HOURS ?? 24);
  return (Number.isFinite(hours) ? hours : 24) * 60 * 60 * 1000;
}

export function isWindowOpen(lastInboundAt: string | null, windowMs: number): boolean {
  if (!lastInboundAt) return false;
  const timestamp = Date.parse(lastInboundAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < windowMs;
}

export async function computeOutboundReadiness(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    externalId: string;
    channel: ChatChannel;
  }
): Promise<OutboundReadiness> {
  const { data: conversation, error } = await supabase
    .from('whatsapp_conversations')
    .select('last_inbound_at')
    .eq('tenant_id', args.tenantId)
    .eq('channel', args.channel)
    .eq('external_id', args.externalId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const lastInboundAt =
    typeof conversation?.last_inbound_at === 'string' ? conversation.last_inbound_at : null;

  if (args.channel === 'instagram') {
    const allowed = isWindowOpen(lastInboundAt, instagramReplyWindowMs());
    return allowed
      ? {
          allowed: true,
          mode: 'reply_window',
          reason: 'Instagram reply window is open.',
          lastInboundAt,
        }
      : {
          allowed: false,
          mode: 'blocked_instagram_window',
          reason:
            'Instagram replies are only allowed within 24 hours of the customer’s last DM.',
          lastInboundAt,
        };
  }

  if (isWindowOpen(lastInboundAt, CFG.windowMs())) {
    return {
      allowed: true,
      mode: 'reply_window',
      reason: 'Customer is within the WhatsApp service window.',
      lastInboundAt,
    };
  }

  const consented = await hasMessagingConsent(supabase, {
    tenantId: args.tenantId,
    recipient: args.externalId,
    channel: 'whatsapp',
  });

  if (consented) {
    return {
      allowed: true,
      mode: 'consented_followup',
      reason: 'Explicit WhatsApp consent exists for follow-up outside the reply window.',
      lastInboundAt,
    };
  }

  return {
    allowed: false,
    mode: 'blocked_consent_required',
    reason:
      'WhatsApp follow-up outside the reply window requires explicit messaging consent.',
    lastInboundAt,
  };
}
