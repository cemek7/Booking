import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('boka-location-staff-api');

/**
 * GET /api/locations/:locationId/staff
 * Retrieves staff members associated with a specific location.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const span = tracer.startSpan('api.locations.staff.get');

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

      // Fetch staff_location links for this location
      const { data: staffLocations, error: slError } = await ctx.supabase
        .from('staff_locations')
        .select('staff_id')
        .eq('location_id', locationId);

      if (slError) {
        throw ApiErrorFactory.databaseError(slError);
      }

      const staffIds = staffLocations?.map(sl => sl.staff_id) || [];

      if (staffIds.length === 0) {
        span.setAttribute('db.results.count', 0);
        return { success: true, staff: [] };
      }

      // Fetch staff members linked to the specified location and tenant
      const { data: staff, error } = await ctx.supabase
        .from('staff')
        .select(`
          *,
          user:users(id, email, raw_user_meta_data)
        `)
        .in('id', staffIds)
        .eq('tenant_id', tenantId);

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }

      span.setAttribute('db.results.count', staff?.length || 0);
      return { success: true, staff: staff || [] };
    } finally {
      span.end();
    }
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
