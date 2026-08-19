import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { defaultLogger } from '@/lib/logger';
import { siasOperations } from '@/lib/sias-operations';

export interface ReminderRunResult {
  processed: number;
  v2_reminders_sent: number;
}

/**
 * Batch-resolve customer display names for a set of reservation customer_ids.
 * reservations stores the phone as `customer_number`; the name lives on `customers`
 * (customer_name / name), reachable via reservations.customer_id.
 */
async function fetchCustomerNames(
  supabase: SupabaseClient,
  customerIds: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const ids = [...new Set(customerIds.filter((v): v is string => !!v))];
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const { data } = await supabase
    .from('customers')
    .select('id, customer_name, name')
    .in('id', ids);
  for (const c of data ?? []) {
    names.set(c.id, c.customer_name ?? c.name ?? null);
  }
  return names;
}

/**
 * Process and send a single tenant's pending reminders.
 *
 * 1. Atomically claims pending `reminders` rows (status pending -> processing) and sends them.
 * 2. Runs the v2 reservation reminder pass (24h / 2h flags on confirmed reservations).
 *
 * Tenant scoping is enforced by the explicit `.eq('tenant_id', tenantId)` on every query, so this is
 * safe to call with either an RLS-scoped route client (session path: /api/reminders/run) or a
 * service-role admin client (cron path: /api/cron/reminders iterating all tenants).
 */
export async function runRemindersForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ReminderRunResult> {
  const now = new Date().toISOString();

  // Atomically claim pending reminders via optimistic locking:
  // UPDATE status to 'processing' WHERE status='pending', then SELECT.
  // This prevents concurrent invocations from sending duplicate reminders.
  const { data: rows, error } = await supabase
    .from('reminders')
    .update({ status: 'processing' })
    .eq('tenant_id', tenantId)
    .lte('remind_at', now)
    .eq('status', 'pending')
    .limit(100)
    .select('id,reservation_id,method,raw,attempts');

  if (error) throw new Error('Failed to fetch reminders');

  let processed = 0;

  for (const r of rows ?? []) {
    try {
      const { id, raw, attempts } = r;
      const toNumber = raw?.to || raw?.phone || null;
      const message = raw?.message || 'Reminder: you have an upcoming booking.';

      if (!toNumber) {
        // Mark as failed when no phone number is available
        const { error: failedUpdateError } = await supabase
          .from('reminders')
          .update({ status: 'failed', attempts: (attempts || 0) + 1 })
          .eq('id', id);
        if (failedUpdateError) {
          defaultLogger.error(`Failed to mark reminder ${id} as failed:`, failedUpdateError);
        }
        continue;
      }

      const client = await getTenantWhatsAppProviderClient(tenantId);
      const sent = client
        ? await client.sendTextMessage(toNumber, message).then(() => ({ success: true })).catch(() => ({ success: false }))
        : { success: false };

      if (sent.success) {
        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: 'reminder',
          action: 'send_reminder',
          targetPhone: toNumber,
          sourceEvent: 'reminder.run',
          status: 'sent',
          metadata: {
            reminder_id: id,
            reason: raw?.reason ?? raw?.label ?? 'scheduled',
          },
          attribution: {
            signal: 'no_show_reduction',
            source_event: 'reminder.run',
          },
        });

        const { error: updateError } = await supabase
          .from('reminders')
          .update({ status: 'sent' })
          .eq('id', id);

        if (!updateError) {
          processed += 1;
        }
      } else {
        const MAX_ATTEMPTS = 5;
        const newAttempts = (attempts || 0) + 1;
        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: 'reminder',
          action: 'send_reminder',
          targetPhone: toNumber,
          sourceEvent: 'reminder.run',
          status: newAttempts >= MAX_ATTEMPTS ? 'failed' : 'retry_scheduled',
          maxAttempts: MAX_ATTEMPTS,
          metadata: {
            reminder_id: id,
            reason: raw?.reason ?? raw?.label ?? 'scheduled',
            attempts: newAttempts,
          },
          attribution: {
            signal: 'no_show_reduction',
            source_event: 'reminder.run',
          },
        });

        const { error: retryUpdateError } = await supabase
          .from('reminders')
          .update({
            attempts: newAttempts,
            status: newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          })
          .eq('id', id);
        if (retryUpdateError) {
          defaultLogger.error(`Failed to update attempts for reminder ${id}:`, retryUpdateError);
        }
      }
    } catch {
      // Continue processing other reminders
      continue;
    }
  }

  // ── v2 reminder pass: reservations with unsent reminder flags ──────────
  let v2processed = 0;

  const client = await getTenantWhatsAppProviderClient(tenantId);
  if (client) {
    // 24h reminders — reservations.customer_number is the phone; name comes from customers.
    const { data: due24h } = await supabase
      .from('reservations')
      .select('id, customer_id, customer_number, start_at, service_id')
      .eq('tenant_id', tenantId)
      .eq('reminder_24h_sent', false)
      .eq('status', 'confirmed')
      .gte('start_at', new Date(Date.now() + 23 * 3600_000).toISOString())
      .lte('start_at', new Date(Date.now() + 25 * 3600_000).toISOString());

    const names24h = await fetchCustomerNames(supabase, (due24h ?? []).map((r) => r.customer_id));

    for (const r of due24h ?? []) {
      if (!r.customer_number) continue;
      const name = names24h.get(r.customer_id) ?? 'there';
      const apptTime = new Date(r.start_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
      const apptDate = new Date(r.start_at).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
      const msg = `Hi ${name}, your appointment is tomorrow (${apptDate}) at ${apptTime}. Reply YES to confirm or CHANGE to reschedule.`;
      try {
        await client.sendTextMessage(r.customer_number, msg);
        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: 'reminder',
          action: 'send_reminder',
          targetPhone: r.customer_number,
          targetBookingId: r.id,
          sourceEvent: 'reservation.reminder_24h',
          status: 'sent',
          metadata: {
            lead_time: '24h',
            service_id: r.service_id ?? null,
          },
          attribution: {
            signal: 'no_show_reduction',
            source_event: 'reservation.reminder_24h',
          },
        });
        await supabase.from('reservations').update({ reminder_24h_sent: true }).eq('id', r.id);
        v2processed++;
      } catch { /* continue */ }
    }

    // 2h reminders
    const { data: due2h } = await supabase
      .from('reservations')
      .select('id, customer_id, customer_number, start_at, service_id')
      .eq('tenant_id', tenantId)
      .eq('reminder_2h_sent', false)
      .eq('status', 'confirmed')
      .gte('start_at', new Date(Date.now() + 1.75 * 3600_000).toISOString())
      .lte('start_at', new Date(Date.now() + 2.25 * 3600_000).toISOString());

    for (const r of due2h ?? []) {
      if (!r.customer_number) continue;
      const apptTime = new Date(r.start_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
      const msg = `Reminder: your appointment is in 2 hours at ${apptTime}. Can't make it? Reply CANCEL to free your slot.`;
      try {
        await client.sendTextMessage(r.customer_number, msg);
        await siasOperations.recordCampaignRun({
          tenantId,
          campaignType: 'reminder',
          action: 'send_reminder',
          targetPhone: r.customer_number,
          targetBookingId: r.id,
          sourceEvent: 'reservation.reminder_2h',
          status: 'sent',
          metadata: {
            lead_time: '2h',
            service_id: r.service_id ?? null,
          },
          attribution: {
            signal: 'no_show_reduction',
            source_event: 'reservation.reminder_2h',
          },
        });
        await supabase.from('reservations').update({ reminder_2h_sent: true }).eq('id', r.id);
        v2processed++;
      } catch { /* continue */ }
    }
  }

  return { processed, v2_reminders_sent: v2processed };
}
