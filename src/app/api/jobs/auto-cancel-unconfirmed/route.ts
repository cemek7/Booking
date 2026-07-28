export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

interface UnconfirmedBooking {
  id: string;
  tenant_id: string;
  customer_number: string | null;
  service_id: string | null;
  start_at: string;
  metadata: Record<string, unknown> | null;
}

interface TenantSettings {
  autoCancelUnconfirmedEnabled?: boolean;
  autoCancelHoursBefore?: number;
}

/**
 * Cron job endpoint to auto-cancel unconfirmed bookings
 * Default: Cancels pending/unconfirmed bookings 2 hours before appointment
 *
 * Call this endpoint via Vercel Cron, Supabase pg_cron, or external scheduler
 * Recommended: Run every 15 minutes
 */
export const POST = createHttpHandler(
  async (ctx) => {
    // Verify cron secret for security
    const cronSecret = ctx.request.headers.get('x-cron-secret');
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret || cronSecret !== expectedSecret) {
      throw ApiErrorFactory.missingAuthorization();
    }

    const results = {
      processed: 0,
      cancelled: 0,
      notified: 0,
      errors: [] as string[]
    };

    try {
      // Get all tenants with auto-cancel enabled (default: enabled)
      const { data: tenants, error: tenantError } = await ctx.supabase
        .from('tenants')
        .select('id, name, settings');

      if (tenantError) {
        throw ApiErrorFactory.databaseError(tenantError);
      }

      for (const tenant of tenants || []) {
        const settings = (tenant.settings || {}) as TenantSettings;

        // Skip if explicitly disabled
        if (settings.autoCancelUnconfirmedEnabled === false) {
          continue;
        }

        // Default: 2 hours before appointment
        const hoursBefore = settings.autoCancelHoursBefore ?? 2;

        // Calculate the cutoff time (appointments starting within `hoursBefore` from now)
        const now = new Date();
        const cutoffTime = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

        // Find unconfirmed reservations that are within the auto-cancel window
        const { data: bookings, error: bookingError } = await ctx.supabase
          .from('reservations')
          .select('id, tenant_id, customer_number, service_id, start_at, metadata')
          .eq('tenant_id', tenant.id)
          .in('status', ['pending', 'pending_approval', 'unconfirmed'])
          .lte('start_at', cutoffTime.toISOString())
          .gt('start_at', now.toISOString());

        if (bookingError) {
          results.errors.push(`Tenant ${tenant.id}: ${bookingError.message}`);
          continue;
        }

        for (const booking of (bookings || []) as UnconfirmedBooking[]) {
          results.processed++;

          try {
            // Cancel the reservation
            const { error: updateError } = await ctx.supabase
              .from('reservations')
              .update({
                status: 'cancelled',
                cancellation_reason: 'Auto-cancelled: Not confirmed within required timeframe',
                cancelled_at: new Date().toISOString()
              })
              .eq('id', booking.id);

            if (updateError) {
              results.errors.push(`Booking ${booking.id}: ${updateError.message}`);
              continue;
            }

            results.cancelled++;

            // Log the auto-cancellation
            await ctx.supabase
              .from('reservation_logs')
              .insert({
                reservation_id: booking.id,
                tenant_id: booking.tenant_id,
                action: 'auto_cancelled',
                actor: { system: 'auto-cancel-job' },
                notes: `Reservation auto-cancelled ${hoursBefore} hour(s) before appointment time`,
                metadata: {
                  reason: 'unconfirmed',
                  original_status: 'pending',
                  hours_before: hoursBefore
                }
              });

            // Notify customer about cancellation via WhatsApp (best effort)
            try {
              await notifyCustomerCancellation(ctx.supabase, booking, tenant.name);
              results.notified++;
            } catch {
              // Don't fail if notification fails
            }

          } catch (err) {
            results.errors.push(`Booking ${booking.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }

      return {
        success: true,
        message: `Auto-cancel job completed`,
        results
      };

    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw ApiErrorFactory.internalServerError(new Error('Auto-cancel job failed'));
    }
  },
  'POST',
  { auth: false } // Cron jobs use secret header instead
);

/**
 * Notify customer that their booking was auto-cancelled
 */
async function notifyCustomerCancellation(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>,
  booking: UnconfirmedBooking,
  tenantName: string
): Promise<void> {
  const phone = booking.customer_number;
  if (!phone) return;

  const meta = booking.metadata || {};
  const customerName = (meta.customer_name as string | undefined) || 'there';
  const serviceName = (meta.service_name as string | undefined) || 'your appointment';

  const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
  const client = await getTenantWhatsAppProviderClient(booking.tenant_id);
  if (!client) return;

  const startAt = new Date(booking.start_at);
  const bookingDate = startAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const bookingTime = startAt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const message =
    `Hi ${customerName},\n\n` +
    `Your reservation at ${tenantName} for ${serviceName} ` +
    `on ${bookingDate} at ${bookingTime} was not confirmed in time ` +
    `and has been automatically cancelled.\n\n` +
    `If you'd like to rebook, please contact us or visit our booking page.\n\n` +
    `We apologize for any inconvenience.`;

  await client.sendTextMessage(phone, message);
}

// GET endpoint for health check / status
export const GET = createHttpHandler(
  async () => {
    return {
      status: 'ok',
      job: 'auto-cancel-unconfirmed',
      description: 'Cancels unconfirmed reservations 2 hours before appointment time',
      schedule: 'Recommended: every 15 minutes'
    };
  },
  'GET',
  { auth: false }
);
