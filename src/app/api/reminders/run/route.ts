export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { defaultLogger } from '@/lib/logger';
import { siasOperations } from '@/lib/sias-operations';

/**
 * POST /api/reminders/run
 * 
 * Process and send pending reminders. This endpoint:
 * 1. Queries reminders with status 'pending' and remind_at <= now
 * 2. Sends WhatsApp messages via the configured WhatsApp provider
 * 3. Updates reminder status (sent/failed) and attempt count
 */

export const POST = createHttpHandler(
  async (ctx) => {
    const now = new Date().toISOString();
    // Derive tenant from authenticated user; reject any header override
    const tenantId = ctx.user!.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }
    
    // Atomically claim pending reminders via optimistic locking:
    // UPDATE status to 'processing' WHERE status='pending', then SELECT.
    // This prevents concurrent invocations from sending duplicate reminders.
    const { data: rows, error } = await ctx.supabase
      .from('reminders')
      .update({ status: 'processing' })
      .eq('tenant_id', tenantId)
      .lte('remind_at', now)
      .eq('status', 'pending')
      .limit(100)
      .select('id,reservation_id,method,raw,attempts');

    if (error) throw ApiErrorFactory.internalServerError(new Error('Failed to fetch reminders'));

    if (!rows || rows.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;

    for (const r of rows) {
      try {
        const { id, raw, attempts } = r;
        const toNumber = raw?.to || raw?.phone || null;
        const message = raw?.message || 'Reminder: you have an upcoming booking.';

        if (!toNumber) {
          // Mark as failed when no phone number is available
          const { error: failedUpdateError } = await ctx.supabase
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

          const { error: updateError } = await ctx.supabase
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

          const { error: retryUpdateError } = await ctx.supabase
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

      // 24h reminders
      const { data: due24h } = await ctx.supabase
        .from('reservations')
        .select('id, customer_phone, customer_name, start_at, service_id')
        .eq('tenant_id', tenantId)
        .eq('reminder_24h_sent', false)
        .eq('status', 'confirmed')
        .gte('start_at', new Date(Date.now() + 23 * 3600_000).toISOString())
        .lte('start_at', new Date(Date.now() + 25 * 3600_000).toISOString());

      for (const r of due24h ?? []) {
        if (!r.customer_phone) continue;
        const apptTime = new Date(r.start_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
        const apptDate = new Date(r.start_at).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
        const msg = `Hi ${r.customer_name ?? 'there'}, your appointment is tomorrow (${apptDate}) at ${apptTime}. Reply YES to confirm or CHANGE to reschedule.`;
        try {
          await client.sendTextMessage(r.customer_phone, msg);
          await siasOperations.recordCampaignRun({
            tenantId,
            campaignType: 'reminder',
            action: 'send_reminder',
            targetPhone: r.customer_phone,
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
          await ctx.supabase.from('reservations').update({ reminder_24h_sent: true }).eq('id', r.id);
          v2processed++;
        } catch { /* continue */ }
      }

      // 2h reminders
      const { data: due2h } = await ctx.supabase
        .from('reservations')
        .select('id, customer_phone, customer_name, start_at, service_id')
        .eq('tenant_id', tenantId)
        .eq('reminder_2h_sent', false)
        .eq('status', 'confirmed')
        .gte('start_at', new Date(Date.now() + 1.75 * 3600_000).toISOString())
        .lte('start_at', new Date(Date.now() + 2.25 * 3600_000).toISOString());

      for (const r of due2h ?? []) {
        if (!r.customer_phone) continue;
        const apptTime = new Date(r.start_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
        const msg = `Reminder: your appointment is in 2 hours at ${apptTime}. Can't make it? Reply CANCEL to free your slot.`;
        try {
          await client.sendTextMessage(r.customer_phone, msg);
          await siasOperations.recordCampaignRun({
            tenantId,
            campaignType: 'reminder',
            action: 'send_reminder',
            targetPhone: r.customer_phone,
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
          await ctx.supabase.from('reservations').update({ reminder_2h_sent: true }).eq('id', r.id);
          v2processed++;
        } catch { /* continue */ }
      }
    }

    return { processed, v2_reminders_sent: v2processed };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
