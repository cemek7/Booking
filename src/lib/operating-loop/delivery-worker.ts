import type { SupabaseClient } from '@supabase/supabase-js';
import { brandCustomerText } from '@/lib/whatsapp/v2/outboundBranding';
import { getConversation } from '@/lib/whatsapp/v2/conversationState';
import { sendGovernedInitiated, type GovernedSendResult } from '@/lib/whatsapp/v2/deliverability/governedSend';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

export type OperatingDeliveryRow = {
  id: string;
  tenant_id: string;
  action_id: string;
  objective_id: string;
  recipient: string;
  payload: { actionType: 'confirm_booking' | 'collect_deposit' | 'follow_up'; content: string };
  idempotency_key: string;
  attempt_count: number;
};

type CompletionStatus = 'sent' | 'held' | 'retry' | 'dead_letter';
type Completion = { status: CompletionStatus; providerMessageId?: string; error?: string; availableAt?: string };

export type OperatingDeliveryWorkerDependencies = {
  admin: SupabaseClient;
  getConversation: typeof getConversation;
  getProvider: typeof getTenantWhatsAppProviderClient;
  governedSend: typeof sendGovernedInitiated;
  brandText: typeof brandCustomerText;
  now?: () => Date;
};

export function retryAt(now: Date, attemptCount: number): string {
  return new Date(now.getTime() + Math.min(60 * 60, Math.max(1, attemptCount) ** 2 * 60) * 1000).toISOString();
}

function asRows(value: unknown): OperatingDeliveryRow[] {
  return Array.isArray(value) ? value as OperatingDeliveryRow[] : [];
}

function templateParams(entries: unknown[]): Array<{ default: string }> {
  return entries.map((entry) => entry && typeof entry === 'object' && 'default' in entry
    ? { default: String((entry as { default?: unknown }).default ?? '') }
    : { default: String(entry ?? '') });
}

function retryOrDeadLetter(row: OperatingDeliveryRow, now: Date, error: string): Completion {
  return row.attempt_count >= 5
    ? { status: 'dead_letter', error }
    : { status: 'retry', error, availableAt: retryAt(now, row.attempt_count) };
}

export async function runOperatingDeliveryBatch(
  deps: OperatingDeliveryWorkerDependencies,
  limit = 20,
): Promise<{ claimed: number; sent: number; held: number; failed: number }> {
  const { data, error } = await deps.admin.rpc('claim_operating_deliveries', { p_limit: limit });
  if (error) throw error;

  const rows = asRows(data);
  const totals = { claimed: rows.length, sent: 0, held: 0, failed: 0 };

  for (const row of rows) {
    let completion: Completion;
    let providerSendStarted = false;
    let brandingBlocked = false;

    try {
      const [conversation, client] = await Promise.all([
        deps.getConversation(row.recipient, row.tenant_id, 'whatsapp'),
        deps.getProvider(row.tenant_id),
      ]);

      if (!client) {
        completion = retryOrDeadLetter(row, (deps.now ?? (() => new Date()))(), 'whatsapp_provider_unavailable');
      } else {
        let providerMessageId: string | undefined;
        const result: GovernedSendResult = await deps.governedSend(deps.admin, {
          tenantId: row.tenant_id,
          recipient: row.recipient,
          messageType: row.payload.actionType,
          lastInboundAt: conversation?.last_inbound_at ?? null,
          optedOutAt: conversation?.opted_out_at ?? null,
          buildFreeform: () => row.payload.content,
          sendFreeform: async (text) => {
            const branded = await deps.brandText(row.tenant_id, row.recipient, text, {
              initiated: true,
              conv: conversation ? { last_inbound_at: conversation.last_inbound_at, opted_out_at: conversation.opted_out_at } : undefined,
            });
            if (!branded) {
              brandingBlocked = true;
              return false;
            }
            providerSendStarted = true;
            const response = await client.sendTextMessage(row.recipient, branded);
            providerMessageId = response.messageId;
            return response.success;
          },
          sendTemplate: async (name, language, mapping) => {
            if (!client.sendTemplateMessage) return false;
            providerSendStarted = true;
            const response = await client.sendTemplateMessage(row.recipient, name, templateParams(mapping), language);
            providerMessageId = response.messageId;
            return response.success;
          },
        });

        // Current provider adapters do not accept an idempotency argument. The
        // outbox retains its deterministic key for audit/reconciliation, and
        // an unprovable provider result is held instead of being retried.
        completion = result.sent && providerMessageId
          ? { status: 'sent', providerMessageId }
          : result.sent
            ? { status: 'held', error: 'provider_message_id_missing' }
          : brandingBlocked
            ? { status: 'held', error: 'opted_out' }
            : result.reason === 'send_failed'
              ? retryOrDeadLetter(row, (deps.now ?? (() => new Date()))(), result.reason)
              : { status: 'held', error: result.reason };
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      completion = providerSendStarted
        ? { status: 'held', error: 'ambiguous_provider_delivery' }
        : retryOrDeadLetter(row, (deps.now ?? (() => new Date()))(), message);
    }

    const { data: completionData, error: completeError } = await deps.admin.rpc('complete_operating_delivery', {
      p_outbox_id: row.id,
      p_status: completion.status,
      p_provider_message_id: completion.providerMessageId ?? null,
      p_error: completion.error ?? null,
      p_available_at: completion.availableAt ?? null,
    });
    if (completeError) throw completeError;
    const completionRows = Array.isArray(completionData) ? completionData : [];
    const confirmed = completionRows.length === 1
      && completionRows[0]
      && typeof completionRows[0] === 'object'
      && (completionRows[0] as { outbox_id?: unknown; status?: unknown }).outbox_id === row.id
      && (completionRows[0] as { status?: unknown }).status === completion.status;
    if (!confirmed) throw new Error('operating delivery completion was not confirmed');

    await captureServerAnalyticsEvent({
      event: ANALYTICS_EVENTS.OPERATING_OBJECTIVE_DELIVERY_OUTCOME,
      properties: {
        tenant_id: row.tenant_id,
        channel: 'whatsapp',
        flow: 'retention',
        metadata: { outcome: completion.status },
      },
    });

    if (completion.status === 'sent') totals.sent += 1;
    else if (completion.status === 'held') totals.held += 1;
    else totals.failed += 1;
  }

  return totals;
}
