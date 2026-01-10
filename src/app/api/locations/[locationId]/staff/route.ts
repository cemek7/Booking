import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/supabaseClient';
import { getSession } from '../../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../../lib/enhanced-rbac';
import { handleApiError } from '../../../../../lib/error-handling';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('boka-location-staff-api');

/**
 * GET /api/locations/:locationId/staff
 * Retrieves staff members associated with a specific location.
 * Requires authenticated user access to the tenant.
 */
export async function GET(req: NextRequest, { params }: { params: { locationId: string } }) {
  const span = tracer.startSpan('api.locations.staff.get');
  try {
    const { locationId } = params;
    span.setAttribute('location.id', locationId);

    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Any authenticated user in the tenant can view staff.
    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createServerSupabaseClient();

    // Fetch staff members linked to the specified location and tenant.
    // This assumes a join table `staff_locations` linking staff and locations.
    const { data: staff, error } = await supabase
      .from('staff')
      .select(`
        *,
        user:users(id, email, raw_user_meta_data)
      `)
      .in('id', 
        (await supabase
          .from('staff_locations')
          .select('staff_id')
          .eq('location_id', locationId)
        ).data?.map(sl => sl.staff_id) || []
      )
      .eq('tenant_id', tenantId); // Tenant isolation

    if (error) {
      throw error;
    }

    span.setAttribute('db.results.count', staff.length);
    return NextResponse.json({ success: true, staff });

  } catch (error) {
    span.recordException(error as Error);
    return handleApiError(error, `Failed to retrieve staff for location ${params.locationId}`);
  } finally {
    span.end();
  }
}
