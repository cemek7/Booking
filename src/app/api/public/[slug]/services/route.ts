/**
 * Public Booking Routes - No Authentication Required
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import publicBookingService from '@/lib/publicBookingService';

/**
 * GET /api/public/[slug]/services
 * Get services for public booking
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = getSupabaseRouteHandlerClient();

    // Get tenant by slug
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', params.slug)
      .maybeSingle();

    if (tenantErr || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const services = await publicBookingService.getTenantServices(tenant.id);
    return NextResponse.json(services);
  } catch (error) {
    console.error('Error fetching services:', error);
    return NextResponse.json(
      { error: 'Failed to fetch services' },
      { status: 500 }
    );
  }
}
