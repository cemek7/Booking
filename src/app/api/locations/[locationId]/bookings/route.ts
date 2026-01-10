import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/supabaseClient';
import { getSession } from '../../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../../lib/enhanced-rbac';
import { z } from 'zod';
import { handleApiError } from '../../../../../lib/error-handling';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('boka-location-bookings-api');

const GetBookingsQuerySchema = z.object({
  start: z.string().datetime('Start date must be a valid ISO 8601 string'),
  end: z.string().datetime('End date must be a valid ISO 8601 string'),
});

/**
 * GET /api/locations/:locationId/bookings
 * Retrieves bookings for a specific location within a given date range.
 * Requires authenticated user access to the tenant.
 */
export async function GET(req: NextRequest, { params }: { params: { locationId: string } }) {
  const span = tracer.startSpan('api.locations.bookings.get');
  try {
    const { locationId } = params;
    span.setAttribute('location.id', locationId);

    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Any authenticated user in the tenant can view bookings.
    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const queryValidation = GetBookingsQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (queryValidation.success === false) {
      return NextResponse.json({ error: 'Invalid query parameters', details: queryValidation.error.issues }, { status: 400 });
    }
    const { start, end } = queryValidation.data;
    span.setAttributes({ 'date.range.start': start, 'date.range.end': end });

    const supabase = createServerSupabaseClient();
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(*),
        service:services(*),
        staff:staff(*)
      `)
      .eq('location_id', locationId)
      .eq('tenant_id', tenantId) // Tenant isolation
      .gte('start_time', start)
      .lte('end_time', end);

    if (error) {
      throw error;
    }

    span.setAttribute('db.results.count', bookings.length);
    return NextResponse.json({ success: true, bookings });

  } catch (error) {
    span.recordException(error as Error);
    return handleApiError(error, `Failed to retrieve bookings for location ${params.locationId}`);
  } finally {
    span.end();
  }
}
