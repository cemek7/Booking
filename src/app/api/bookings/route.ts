import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

// Schema for GET request query parameters
const GetBookingsQuerySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  staff_id: z.string().uuid().optional(),
});

// Schema for POST request body
const CreateBookingBodySchema = z.object({
  customer_name: z.string().min(1),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  customer_id: z.string().uuid().optional(),
  customer_number: z.string().optional(),
  phone: z.string().optional(),
});

type Booking = {
  id: string;
  start: string;
  end: string;
  status: string;
  serviceId: string;
  staffId?: string;
  customer: { id: string; name?: string };
  metadata: { tenantId: string };
};

/**
 * GET /api/bookings
 * Fetches bookings for a given time range and optional staff member.
 * Requires authentication and tenant access.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const queryValidation = GetBookingsQuerySchema.safeParse({
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
      staff_id: url.searchParams.get('staff_id'),
    });

    if (!queryValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid query parameters', queryValidation.error.issues);
    }

    const { start, end, staff_id } = queryValidation.data;

    let query = ctx.supabase
      .from('reservations')
      .select('id, tenant_id, staff_id, start_at, end_at, status, service_id, customer_id, customer_name, customer_number, phone')
      .eq('tenant_id', ctx.user!.tenantId)
      .lt('start_at', end)
      .gt('end_at', start)
      .order('start_at', { ascending: true });

    if (staff_id) {
      query = query.eq('staff_id', staff_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch bookings:', error);
      throw ApiErrorFactory.internalServerError('Failed to fetch bookings');
    }

    const bookings: Booking[] = (data || []).map((row: any) => ({
      id: row.id,
      start: row.start_at,
      end: row.end_at,
      status: row.status || 'confirmed',
      serviceId: row.service_id || 'unknown',
      staffId: row.staff_id,
      customer: {
        id: row.customer_id || row.customer_number || row.phone || row.customer_name || 'unknown',
        name: row.customer_name,
      },
      metadata: { tenantId: row.tenant_id },
    }));

    return { bookings };
  },
  'GET',
  { auth: true }
);

/**
 * POST /api/bookings
 * Creates a new booking for the user's tenant.
 * Requires authentication and tenant access.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = CreateBookingBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid request body', bodyValidation.error.issues);
    }

    const { start_at, end_at, staff_id, ...bookingData } = bodyValidation.data;

    // Conflict check for the given staff member
    if (staff_id) {
      const { data: overlaps, error: overlapErr } = await ctx.supabase
        .from('reservations')
        .select('id')
        .eq('tenant_id', ctx.user!.tenantId)
        .eq('staff_id', staff_id)
        .lt('start_at', end_at)
        .gt('end_at', start_at)
        .limit(1);

      if (overlapErr) {
        console.error('Error checking for booking conflicts:', overlapErr);
        throw ApiErrorFactory.internalServerError('Failed to check for conflicts');
      }
      if (overlaps && overlaps.length > 0) {
        throw ApiErrorFactory.conflict('A conflicting booking already exists for this staff member at the selected time.');
      }
    }

    const insertPayload = {
      ...bookingData,
      tenant_id: ctx.user!.tenantId,
      start_at,
      end_at,
      staff_id: staff_id || null,
      status: 'confirmed',
    };

    const { data: inserted, error } = await ctx.supabase
      .from('reservations')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('Failed to create booking:', error);
      throw ApiErrorFactory.internalServerError('Failed to create booking');
    }

    return inserted;
  },
  'POST',
  { auth: true }
);

