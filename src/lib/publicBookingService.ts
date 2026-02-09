/**
 * Public Booking API Routes
 * No authentication required - for public-facing booking
 */

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/public/[slug]
 * Get public tenant information
 */
export async function getTenantPublicInfo(slug: string) {
  const supabase = getSupabaseRouteHandlerClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(`
      id,
      name,
      slug,
      description,
      logo_url,
      industry,
      settings
    `)
    .eq('slug', slug)
    .maybeSingle();

  if (error || !tenant) {
    throw ApiErrorFactory.notFound('Tenant');
  }

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    description: tenant.description,
    logo: tenant.logo_url,
    industry: tenant.industry,
    settings: tenant.settings,
  };
}

/**
 * GET /api/public/[slug]/services
 * Get available services for tenant
 */
export async function getTenantServices(tenantId: string) {
  const supabase = getSupabaseRouteHandlerClient();

  const { data: services, error } = await supabase
    .from('services')
    .select(`
      id,
      name,
      description,
      duration,
      price,
      image_url
    `)
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (error) {
    throw ApiErrorFactory.databaseError(new Error(error.message));
  }

  return services || [];
}

/**
 * GET /api/public/[slug]/availability
 * Get available time slots for a date
 */
export async function getAvailability(
  tenantId: string,
  serviceId: string,
  date: string,
  _staffId?: string
) {
  const supabase = getSupabaseRouteHandlerClient();

  // Parse date
  const targetDate = new Date(date);
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Get service duration
  const { data: service } = await supabase
    .from('services')
    .select('duration')
    .eq('id', serviceId)
    .single();

  if (!service) {
    throw ApiErrorFactory.notFound('Service');
  }

  const durationMinutes = service.duration || 60;

  // Get business hours for the day
  const { data: hours } = await supabase
    .from('business_hours')
    .select('start_time, end_time')
    .eq('tenant_id', tenantId)
    .eq('day_of_week', targetDate.getDay())
    .maybeSingle();

  if (!hours) {
    return []; // Closed on this day
  }

  // Get existing reservations
  const { data: reservations } = await supabase
    .from('reservations')
    .select('start_at, end_at')
    .eq('tenant_id', tenantId)
    .gte('start_at', dayStart.toISOString())
    .lte('end_at', dayEnd.toISOString())
    .in('status', ['confirmed', 'pending']);

  // Generate slots
  const slots = generateTimeSlots(
    hours.start_time,
    hours.end_time,
    durationMinutes,
    reservations || []
  );

  return slots;
}

/**
 * Helper: Get or create customer
 */
async function getCustomer(tenantId: string, payload: {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}) {
  const supabase = getSupabaseRouteHandlerClient();
  
  // Get or create customer
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email', payload.customer_email)
    .maybeSingle();

  if (!customer) {
    const { data: newCustomer, error: createErr } = await supabase
      .from('customers')
      .insert({
        tenant_id: tenantId,
        name: payload.customer_name,
        email: payload.customer_email,
        phone: payload.customer_phone,
        source: 'public_booking',
      })
      .select('id')
      .single();

    if (createErr || !newCustomer) {
      throw ApiErrorFactory.databaseError(new Error(createErr?.message || 'Failed to create customer'));
    }

    return newCustomer;
  }

  return customer;
}

/**
 * POST /api/public/[slug]/book
 * Create a booking (without authentication)
 */
export async function createPublicBooking(
  tenantId: string,
  payload: {
    service_id: string;
    staff_id?: string;
    date: string;
    time: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    notes?: string;
  }
) {
  const supabase = getSupabaseRouteHandlerClient();

  // Get or create customer
  const customer = await getCustomer(tenantId, payload);

  // Parse start time and validate
  const startTime = new Date(`${payload.date}T${payload.time}`);
  
  if (isNaN(startTime.getTime())) {
    throw ApiErrorFactory.badRequest('Invalid date or time format');
  }
  const { data: service } = await supabase
    .from('services')
    .select('duration')
    .eq('id', payload.service_id)
    .single();

  const endTime = new Date(startTime.getTime() + (service?.duration || 60) * 60000);

  // Create booking
  const { data: booking, error: bookingErr } = await supabase
    .from('reservations')
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      service_id: payload.service_id,
      staff_id: payload.staff_id || null,
      start_at: startTime.toISOString(),
      end_at: endTime.toISOString(),
      status: 'pending',
      notes: payload.notes,
      source: 'public_booking',
      metadata: {
        booking_source: 'public_storefront',
        timestamp: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (bookingErr || !booking) {
    throw ApiErrorFactory.databaseError(new Error(bookingErr?.message || 'Failed to create booking'));
  }

  return booking;
}

/**
 * Helper: Generate available time slots
 */
function generateTimeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  existingReservations: Array<{ start_at: string; end_at: string }>
): Array<{ time: string; available: boolean }> {
  const slots: Array<{ time: string; available: boolean }> = [];

  // Parse business hours
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  let current = new Date();
  current.setHours(startHour, startMin, 0);

  const dayEnd = new Date();
  dayEnd.setHours(endHour, endMin, 0);

  // Generate 30-minute intervals
  while (current < dayEnd) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60000);

    // Check if slot overlaps with any reservation
    const isBooked = existingReservations.some(res => {
      const resStart = new Date(res.start_at);
      const resEnd = new Date(res.end_at);
      return current < resEnd && slotEnd > resStart;
    });

    slots.push({
      time: current.toTimeString().substring(0, 5),
      available: !isBooked && slotEnd <= dayEnd,
    });

    current = new Date(current.getTime() + 30 * 60000); // 30-minute intervals
  }

  return slots;
}

const publicBookingService = {
  getTenantPublicInfo,
  getTenantServices,
  getAvailability,
  createPublicBooking,
};

export default publicBookingService;
