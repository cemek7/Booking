/**
 * Public Booking Routes - No Authentication Required
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';
import publicBookingService from '@/lib/publicBookingService';
import { sendBookingConfirmation, sendEmail } from '@/lib/integrations/email-service';
import type { RouteContext } from '@/lib/error-handling/route-handler';

/**
 * Helper to get tenant by slug
 */
async function getTenantBySlug(ctx: RouteContext, slug: string) {
  const { data: tenant, error: tenantErr } = await ctx.supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (tenantErr) {
    throw ApiErrorFactory.databaseError(new Error(tenantErr.message));
  }

  if (!tenant) {
    throw ApiErrorFactory.notFound('Tenant');
  }

  return tenant;
}

/**
 * POST /api/public/[slug]/book
 * Create a booking from public storefront
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;

    if (!slug || typeof slug !== 'string') {
      throw ApiErrorFactory.badRequest('Slug required');
    }

    const body = await ctx.request.json();

    // Validate input
    const bookingSchema = z.object({
      service_id: z.string().uuid(),
      staff_id: z.string().uuid().optional(),
      date: z.string().date(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      customer_name: z.string().min(1).max(255),
      customer_email: z.string().email(),
      customer_phone: z.string().min(10).max(20),
      notes: z.string().max(500).optional(),
    });

    const parseResult = bookingSchema.safeParse(body);
    
    if (!parseResult.success) {
      throw ApiErrorFactory.validationError({
        message: 'Invalid booking data',
        errors: parseResult.error.issues,
      });
    }

    const validated = parseResult.data;

    const tenant = await getTenantBySlug(ctx, slug);

    // Create booking
    const booking = await publicBookingService.createPublicBooking(
      tenant.id,
      {
        ...validated,
        date: validated.date,
        time: validated.time,
      }
    );

    // Send confirmation email to customer and notify tenant owner.
    // Fire-and-forget — notifications must not block the booking response.
    void (async () => {
      try {
        const [serviceRes, tenantRes] = await Promise.all([
          ctx.supabase
            .from('services')
            .select('name')
            .eq('id', validated.service_id)
            .maybeSingle(),
          ctx.supabase
            .from('tenants')
            .select('name, settings')
            .eq('id', tenant.id)
            .maybeSingle(),
        ]);

        const serviceName: string = (serviceRes.data?.name as string) ?? 'your appointment';
        const tenantSettings = tenantRes.data?.settings as Record<string, unknown> | null;
        const ownerEmail = tenantSettings?.contact_email as string | undefined;

        await sendBookingConfirmation(validated.customer_email, validated.customer_name, {
          serviceName,
          date: validated.date,
          time: validated.time,
        });

        if (ownerEmail) {
          await sendEmail({
            to: ownerEmail,
            subject: `New Booking: ${serviceName} on ${validated.date}`,
            html: `
              <h3>New Public Booking</h3>
              <p><strong>Customer:</strong> ${validated.customer_name}</p>
              <p><strong>Email:</strong> ${validated.customer_email}</p>
              <p><strong>Phone:</strong> ${validated.customer_phone}</p>
              <p><strong>Service:</strong> ${serviceName}</p>
              <p><strong>Date:</strong> ${validated.date} at ${validated.time}</p>
              ${validated.notes ? `<p><strong>Notes:</strong> ${validated.notes}</p>` : ''}
              <p><strong>Booking ID:</strong> ${booking.id}</p>
            `,
          });
        }
      } catch (err) {
        console.warn('[public/book] Failed to send notifications:', err);
      }
    })();

    return { booking_id: booking.id, status: 'pending' };
  },
  'POST',
  { auth: false }
);
