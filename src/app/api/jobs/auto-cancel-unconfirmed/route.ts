import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

interface UnconfirmedBooking {
  id: string;
  tenant_id: string;
  customer_phone: string;
  customer_name: string;
  service_type: string;
  booking_date: string;
  booking_time: string;
  start_time: string;
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

    if (expectedSecret && cronSecret !== expectedSecret) {
      throw ApiErrorFactory.authError('Invalid cron secret');
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

        // Find unconfirmed bookings that are within the auto-cancel window
        const { data: bookings, error: bookingError } = await ctx.supabase
          .from('bookings')
          .select('id, tenant_id, customer_phone, customer_name, service_type, booking_date, booking_time, start_time')
          .eq('tenant_id', tenant.id)
          .in('status', ['pending', 'pending_approval', 'unconfirmed'])
          .lte('start_time', cutoffTime.toISOString())
          .gt('start_time', now.toISOString());

        if (bookingError) {
          results.errors.push(`Tenant ${tenant.id}: ${bookingError.message}`);
          continue;
        }

        for (const booking of (bookings || []) as UnconfirmedBooking[]) {
          results.processed++;

          try {
            // Cancel the booking
            const { error: updateError } = await ctx.supabase
              .from('bookings')
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
                notes: `Booking auto-cancelled ${hoursBefore} hour(s) before appointment time`,
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
      throw ApiErrorFactory.internalError('Auto-cancel job failed');
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
  if (!booking.customer_phone) return;

  // Get Evolution client config for tenant
  const { data: tenantConfig } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', booking.tenant_id)
    .single();

  const settings = tenantConfig?.settings as { evolutionInstance?: string; evolutionApiKey?: string } | null;

  if (!settings?.evolutionInstance) {
    return;
  }

  // Dynamic import to avoid circular dependencies
  const { EvolutionClient } = await import('@/lib/evolutionClient');
  const client = EvolutionClient.getInstance();

  const message =
    `Hi ${booking.customer_name || 'there'},\n\n` +
    `Your booking at ${tenantName} for ${booking.service_type || 'your appointment'} ` +
    `on ${booking.booking_date} at ${booking.booking_time} was not confirmed in time ` +
    `and has been automatically cancelled.\n\n` +
    `If you'd like to rebook, please contact us or visit our booking page.\n\n` +
    `We apologize for any inconvenience.`;

  await client.sendMessage(booking.tenant_id, booking.customer_phone, message);
}

// GET endpoint for health check / status
export const GET = createHttpHandler(
  async () => {
    return {
      status: 'ok',
      job: 'auto-cancel-unconfirmed',
      description: 'Cancels unconfirmed bookings 2 hours before appointment time',
      schedule: 'Recommended: every 15 minutes'
    };
  },
  'GET',
  { auth: false }
);
