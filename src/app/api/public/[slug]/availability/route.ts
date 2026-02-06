/**
 * Public Booking Routes - No Authentication Required
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import publicBookingService from '@/lib/publicBookingService';

/**
 * GET /api/public/[slug]/availability
 * Get available slots for a date
 * Query params: serviceId, date, staffId (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const url = new URL(request.url);
    const serviceId = url.searchParams.get('serviceId');
    const date = url.searchParams.get('date');
    const staffId = url.searchParams.get('staffId');

    if (!serviceId || !date) {
      return NextResponse.json(
        { error: 'serviceId and date required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseRouteHandlerClient();

    // Get tenant by slug
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', params.slug)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const slots = await publicBookingService.getAvailability(
      tenant.id,
      serviceId,
      date,
      staffId || undefined
    );

    return NextResponse.json({ slots });
  } catch (error) {
    console.error('Error fetching availability:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch availability' },
      { status: 500 }
    );
  }
}
