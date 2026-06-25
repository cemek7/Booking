export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('boka-location-bookings-api');

const GetBookingsQuerySchema = z.object({
  start: z.string().datetime('Start date must be a valid ISO 8601 string'),
  end: z.string().datetime('End date must be a valid ISO 8601 string'),
});

/**
 * GET /api/locations/:locationId/bookings
 * Retrieves bookings for a specific location within a given date range.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const span = tracer.startSpan('api.locations.bookings.get');

    try {
      const locationId = ctx.params?.locationId;
      if (!locationId) {
        throw ApiErrorFactory.validationError({ locationId: 'Location ID is required' });
      }
      span.setAttribute('location.id', locationId);

      const tenantId = ctx.user?.tenantId;
      if (!tenantId) {
        throw ApiErrorFactory.forbidden('Tenant ID required');
      }

      const url = new URL(ctx.request.url);
      const queryValidation = GetBookingsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!queryValidation.success) {
        throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
      }

      const { start, end } = queryValidation.data;
      span.setAttributes({ 'date.range.start': start, 'date.range.end': end });

      const { data: reservations, error } = await ctx.supabase
        .from('reservations')
        .select('id, tenant_id, location_id, customer_id, customer_name, phone, service_id, staff_id, start_at, end_at, status, notes')
        .eq('location_id', locationId)
        .eq('tenant_id', tenantId)
        .gte('start_at', start)
        .lte('end_at', end);

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }

      const bookings = (reservations || []).map((reservation) => ({
        ...reservation,
        start_time: reservation.start_at,
        end_time: reservation.end_at,
      }));

      span.setAttribute('db.results.count', bookings.length || 0);
      return { success: true, bookings };
    } finally {
      span.end();
    }
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
