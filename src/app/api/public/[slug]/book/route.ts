/**
 * Public Booking Routes - No Authentication Required
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import publicBookingService from '@/lib/publicBookingService';

/**
 * POST /api/public/[slug]/book
 * Create a booking from public storefront
 */
export async function POST(
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
