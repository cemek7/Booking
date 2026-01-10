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
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }
    
    const { data: rows, error } = await ctx.supabase
      .from('reminders')
      .select('id,tenant_id,reservation_id,method,raw,attempts')
      .eq('tenant_id', tenantId)
      .lte('remind_at', now)
      .eq('status', 'pending')
      .limit(100);

    if (error) throw ApiErrorFactory.internal('Failed to fetch reminders');

    if (!rows || rows.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;

    for (const r of rows) {
      try {
        const { id, tenant_id: tenantId, raw, attempts } = r;
        const toNumber = raw?.to || raw?.phone || null;
        const message = raw?.message || 'Reminder: you have an upcoming booking.';

        if (toNumber) {
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
            const { error: updateError } = await ctx.supabase
              .from('reminders')
              .update({ attempts: (attempts || 0) + 1 })
              .eq('id', id);
          }
        }
      } catch (err) {
        // Continue processing other reminders
        continue;
      }
    }

    return { processed };
  },
  'POST',
  { auth: true }
);

            if (updateError) {
              console.error(`[api/reminders/run] Failed to update attempts for reminder ${id}:`, updateError);
            }
          }
        } else {
          // No phone number - mark as failed
          const { error: updateError } = await supabase
            .from('reminders')
            .update({ status: 'failed' })
            .eq('id', id);

          if (updateError) {
            console.error(`[api/reminders/run] Failed to mark reminder ${id} as failed:`, updateError);
          }
        }
      } catch (err) {
        console.error('[api/reminders/run] error processing reminder', err);
      }
    }

    return NextResponse.json({ processed });
  } catch (err: unknown) {
    console.error('[api/reminders/run] error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
