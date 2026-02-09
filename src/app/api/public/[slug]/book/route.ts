/**
 * Public Booking Routes - No Authentication Required
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';
import publicBookingService from '@/lib/publicBookingService';
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
        errors: parseResult.error.errors,
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

    // TODO: Send confirmation email/WhatsApp
    // TODO: Notify tenant owner

    return { booking_id: booking.id, status: 'pending' };
  },
  'POST',
  { auth: false }
);
