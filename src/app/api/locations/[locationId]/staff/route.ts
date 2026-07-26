export const dynamic = 'force-dynamic';
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

      const staffIds = staffLocations?.map((sl: { staff_id: string }) => sl.staff_id) || [];

      if (staffIds.length === 0) {
        span.setAttribute('db.results.count', 0);
        return { success: true, staff: [] };
      }

      // Fetch staff members linked to the specified location and tenant.
      // Staff identity lives in tenant_users (staff_locations.staff_id = tenant_users.user_id).
      const { data: staff, error } = await ctx.supabase
        .from('tenant_users')
        .select('user_id, role, email, name, phone')
        .in('user_id', staffIds)
        .eq('tenant_id', tenantId);

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }

      const rows = (staff || []).map((row: { user_id: string; role: string; email: string | null; name: string | null; phone: string | null }) => ({
        id: row.user_id,
        name: row.name || row.email || row.user_id,
        email: row.email,
        phone: row.phone,
        role: row.role,
      }));

      span.setAttribute('db.results.count', rows.length);
      return { success: true, staff: rows };
    } finally {
      span.end();
    }
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
