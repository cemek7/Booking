/**
 * Auto-Waitlist
 *
 * When a booking is cancelled or rescheduled, checks if any active
 * conversations have expressed interest in that slot and notifies them
 * via WhatsApp that the slot has opened up.
 *
 * Waitlist interest is stored in flow_data.waitlist_interest[]:
 *   { service_id, date, staff_id?, notified_at? }
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { getProviderClient } from '@/lib/whatsapp/providers';
import { brandCustomerText } from './outboundBranding';
import { sendGovernedInitiated } from './deliverability/governedSend';

const supabaseAdmin = createSupabaseAdminClient();

export interface WaitlistEntry {
  service_id: string;
  date: string;
  staff_id?: string;
}

function toTemplateParameters(paramMapping: unknown[]): Array<{ default: string }> {
  return paramMapping.map((entry) => {
    if (entry && typeof entry === 'object' && 'default' in entry) {
      return { default: String((entry as { default?: unknown }).default ?? '') };
    }

    return { default: String(entry ?? '') };
  });
}

// ─── Register waitlist interest ───────────────────────────────────────────────

/**
 * Called when a customer was shown no availability and wants to be notified
 * if a slot opens up for a given service/date/staff combination.
 */
export async function addToWaitlist(
  phone: string,
  tenantId: string,
  entry: WaitlistEntry
): Promise<void> {
  const { data } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('flow_data')
    .eq('phone_number', phone)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const flowData = data?.flow_data ?? {};
  const waitlist: WaitlistEntry[] = flowData.waitlist_interest ?? [];

  // Avoid duplicates
  const alreadyWaiting = waitlist.some(
    (w) => w.service_id === entry.service_id && w.date === entry.date
  );
  if (alreadyWaiting) return;

  waitlist.push(entry);

  await supabaseAdmin
    .from('whatsapp_conversations')
    .update({ flow_data: { ...flowData, waitlist_interest: waitlist } })
    .eq('phone_number', phone)
    .eq('tenant_id', tenantId);
}

// ─── Notify waitlist on slot opening ─────────────────────────────────────────

/**
 * Called whenever a reservation is cancelled or a slot becomes available.
 * Finds all conversations in the tenant that have waitlist interest
 * for this service+date and sends them a notification.
 */
export async function notifyWaitlist(
  tenantId: string,
  serviceId: string,
  date: string,
  startTime: string,
  staffName: string,
  serviceName: string,
  instanceKey: string // Evolution API instance
): Promise<void> {
  // Find all conversations with matching waitlist interest
  const { data: conversations } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('phone_number, flow_data, last_inbound_at, opted_out_at')
    .eq('tenant_id', tenantId)
    .not('flow_data->waitlist_interest', 'is', null);

  if (!conversations || conversations.length === 0) return;

  for (const conv of conversations) {
    const waitlist: WaitlistEntry[] = conv.flow_data?.waitlist_interest ?? [];
    const interested = waitlist.find(
      (w) => w.service_id === serviceId && w.date === date
    );

    if (!interested) continue;

    const dateFormatted = new Date(date).toLocaleDateString('en-NG', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

    const message =
      `🎉 Good news! A slot just opened up.\n\n` +
      `*${serviceName}* with ${staffName}\n` +
      `${dateFormatted} at ${startTime}\n\n` +
      `Reply *YES* to grab this slot, or *NO* to skip.`;

    const config = await getTenantWhatsAppConfig(tenantId);
    if (config) {
      const client = getProviderClient({ ...config, instanceName: instanceKey });
      const result = await sendGovernedInitiated(supabaseAdmin as never, {
        tenantId,
        recipient: conv.phone_number,
        messageType: 'waitlist_slot',
        lastInboundAt: typeof conv.last_inbound_at === 'string' ? conv.last_inbound_at : null,
        optedOutAt: typeof conv.opted_out_at === 'string' ? conv.opted_out_at : null,
        buildFreeform: () => message,
        sendFreeform: async (text) => {
          const branded = await brandCustomerText(
            tenantId,
            conv.phone_number,
            text,
            {
              initiated: true,
              conv: {
                last_inbound_at: typeof conv.last_inbound_at === 'string' ? conv.last_inbound_at : null,
                opted_out_at: typeof conv.opted_out_at === 'string' ? conv.opted_out_at : null,
              },
            },
          );
          if (!branded) return false;
          const sendRes = await client.sendTextMessage(conv.phone_number, branded);
          return sendRes.success;
        },
        sendTemplate: async (name, language, paramMapping) => {
          if (!client.sendTemplateMessage) return false;
          const sendRes = await client.sendTemplateMessage(
            conv.phone_number,
            name,
            toTemplateParameters(paramMapping),
            language,
          );
          return sendRes.success;
        },
      });

      if (!result.sent) continue;
    }

    // Mark as notified (so we don't double-notify)
    const updatedWaitlist = waitlist.map((w) =>
      w.service_id === serviceId && w.date === date
        ? { ...w, notified_at: new Date().toISOString() }
        : w
    );

    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({
        flow_data: { ...conv.flow_data, waitlist_interest: updatedWaitlist },
        current_flow: 'booking',
        flow_step: 4, // confirmation step — awaiting YES/NO
      })
      .eq('phone_number', conv.phone_number)
      .eq('tenant_id', tenantId);
  }
}
