import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { bookingCancelled } from '@/lib/metrics';
import { z } from 'zod';

const UpdateBookingSchema = z.object({
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  staff_id: z.string().uuid().nullable().optional(),
  status: z.enum(['confirmed', 'cancelled']).optional(),
});

type RouteContext = {
  params: {
    id: string;
  };
};

/**
 * PATCH /api/bookings/:id
 * Updates a booking's time, staff, or status.
 * Requires authentication and tenant access.
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const params = ctx.request.nextUrl.searchParams;
    // Extract params from route - this is passed via context in the handler
    const bookingId = (ctx as any).params?.id;
    
    if (!bookingId) {
      throw ApiErrorFactory.badRequest('Booking ID is required');
    }

    const body = await ctx.request.json();
    const validation = UpdateBookingSchema.safeParse(body);

    if (!validation.success) {
      throw ApiErrorFactory.badRequest('Invalid request body', validation.error.issues);
    }

    const updateData = validation.data;
    const isCancellation = updateData.status === 'cancelled';

    if (!isCancellation && (!updateData.start_at || !updateData.end_at)) {
      throw ApiErrorFactory.badRequest('start_at and end_at are required for rescheduling');
    }

    // Fetch existing booking to verify ownership and get current state
    const { data: existing, error: fetchError } = await ctx.supabase
      .from('reservations')
      .select('id, tenant_id, staff_id')
      .eq('id', bookingId)
      .eq('tenant_id', ctx.user!.tenantId)
      .single();

    if (fetchError || !existing) {
      throw ApiErrorFactory.notFound('Booking not found or access denied');
    }

    // Conflict check if rescheduling or changing staff
    if (!isCancellation) {
      const targetStaffId = updateData.staff_id !== undefined ? updateData.staff_id : existing.staff_id;
      if (targetStaffId) {
        const { data: overlaps, error: conflictError } = await ctx.supabase
          .from('reservations')
          .select('id')
          .eq('tenant_id', ctx.user!.tenantId)
          .eq('staff_id', targetStaffId)
          .neq('id', bookingId)
          .lt('start_at', updateData.end_at!)
          .gt('end_at', updateData.start_at!)
          .limit(1);

        if (conflictError) {
          console.error('Error checking for booking conflicts:', conflictError);
          throw ApiErrorFactory.internalServerError('Failed to check for conflicts');
        }
        if (overlaps && overlaps.length > 0) {
          throw ApiErrorFactory.conflict('A conflicting booking already exists for this staff member at the selected time.');
        }
      }
    }

    // Prepare and execute the update
    const { data: updated, error: updateError } = await ctx.supabase
      .from('reservations')
      .update(updateData)
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update booking:', updateError);
      throw ApiErrorFactory.internalServerError('Failed to update booking');
    }

    if (isCancellation) {
      try {
        bookingCancelled(existing.tenant_id);
      } catch (metricError) {
        console.warn('Failed to record booking cancellation metric:', metricError);
      }
    }

    return updated;
  },
  'PATCH',
  { auth: true }
);

