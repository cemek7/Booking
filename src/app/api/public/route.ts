/**
 * Public Booking Routes - No Authentication Required
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import publicBookingService from '@/lib/publicBookingService';

/**
 * GET /api/public/[slug]
 * Get public tenant info (header, logo, description)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;

    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 });
    }

    const tenantInfo = await publicBookingService.getTenantPublicInfo(slug);
    return NextResponse.json(tenantInfo);

  } catch (error) {
    console.error('Error fetching tenant info:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tenant' },
      { status: 404 }
    );
  }
}

/**
 * GET /api/public/[slug]/services
 * Get services for public booking
 */
export async function getServices(
  request: NextRequest,
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

/**
 * GET /api/public/[slug]/availability
 * Get available slots for a date
 * Query params: serviceId, date, staffId (optional)
 */
export async function getAvailability(
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

/**
 * POST /api/public/[slug]/book
 * Create a booking from public storefront
 */
export async function createBooking(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const body = await request.json();

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

    const validated = bookingSchema.parse(body);

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

    return NextResponse.json(
      { booking_id: booking.id, status: 'pending' },
      { status: 201 }
    );

  } catch (error) {
    console.error('Error creating booking:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create booking' },
      { status: 500 }
    );
  }
}

export { getServices as GET_SERVICES, getAvailability as GET_AVAILABILITY, createBooking as POST_BOOKING };
