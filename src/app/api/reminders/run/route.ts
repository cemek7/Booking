import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import EvolutionClient from '@/lib/evolutionClient';

/**
 * POST /api/reminders/run
 * 
 * Process and send pending reminders. This endpoint:
 * 1. Queries reminders with status 'pending' and remind_at <= now
 * 2. Sends WhatsApp messages via Evolution API
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
    
    const { data: rows, error } = await ctx.supabase
      .from('reminders')
      .select('id,reservation_id,method,raw,attempts')
      .eq('tenant_id', tenantId)
      .lte('remind_at', now)
      .eq('status', 'pending')
      .limit(100);

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
          await ctx.supabase
            .from('reminders')
            .update({ status: 'failed', attempts: (attempts || 0) + 1 })
            .eq('id', id);
          continue;
        }

        const sent = await EvolutionClient.sendWhatsAppMessage(tenantId, toNumber, message);

        if (sent.success) {
          const { error: updateError } = await ctx.supabase
            .from('reminders')
            .update({ status: 'sent' })
            .eq('id', id);

          if (!updateError) {
            processed += 1;
          }
        } else {
          await ctx.supabase
            .from('reminders')
            .update({ attempts: (attempts || 0) + 1 })
            .eq('id', id);
        }
      } catch (err) {
        // Continue processing other reminders
        continue;
      }
    }

    return { processed };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
