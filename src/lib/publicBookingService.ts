/**
 * Public Booking API Routes
 * No authentication required - for public-facing booking
 * 
 * Timezone Handling:
 * - All dates are handled in the server's timezone
 * - Clients should send dates in ISO 8601 format or ensure timezone compatibility
 * - Business hours are stored in the tenant's local timezone
 */

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import type { TimeSlot } from '@/types';
import { DoubleBookingPrevention } from '@/lib/doubleBookingPrevention';

const SLOT_INTERVAL_MINUTES = 30;

function parseAvailabilityDate(date: string): Date {
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const monthIndex = Number(isoDateMatch[2]) - 1;
    const day = Number(isoDateMatch[3]);
    const parsed = new Date(year, monthIndex, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === monthIndex && parsed.getDate() === day) {
      return parsed;
    }
  }

  throw ApiErrorFactory.badRequest('Invalid date format. Expected YYYY-MM-DD');
}

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

  // Date is interpreted in the server timezone. Clients should send YYYY-MM-DD in the tenant's timezone.
  const targetDate = parseAvailabilityDate(date);
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Get service duration
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('duration')
    .eq('id', serviceId)
    .maybeSingle();

  if (serviceError) {
    throw ApiErrorFactory.databaseError(new Error(serviceError.message));
  }

  if (!service) {
    throw ApiErrorFactory.notFound('Service');
  }

  const durationMinutes = service.duration || 60;

  // Get business hours for the day
  const { data: hours, error: hoursError } = await supabase
    .from('business_hours')
    .select('start_time, end_time')
    .eq('tenant_id', tenantId)
    .eq('day_of_week', targetDate.getDay())
    .maybeSingle();

  if (hoursError) {
    throw ApiErrorFactory.databaseError(new Error(hoursError.message));
  }

  if (!hours) {
    return []; // Closed on this day
  }

  // Get existing reservations
  const { data: reservations, error: reservationsError } = await supabase
    .from('reservations')
    .select('start_at, end_at')
    .eq('tenant_id', tenantId)
    .lte('start_at', dayEnd.toISOString())
    .gte('end_at', dayStart.toISOString())
    .in('status', ['confirmed', 'pending']);

  if (reservationsError) {
    throw ApiErrorFactory.databaseError(new Error(reservationsError.message));
  }

  // Generate slots
  const slots = generateTimeSlots(
    hours.start_time,
    hours.end_time,
    durationMinutes,
    reservations || [],
    targetDate
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
  
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('duration')
    .eq('id', payload.service_id)
    .maybeSingle();

  if (serviceError) {
    throw ApiErrorFactory.databaseError(new Error(serviceError.message));
  }

  if (!service) {
    throw ApiErrorFactory.notFound('Service');
  }

  const endTime = new Date(startTime.getTime() + (service.duration || 60) * 60000);

  // Use DoubleBookingPrevention service for transactionally safe conflict detection
  const bookingPrevention = new DoubleBookingPrevention(supabase);
  
  // Acquire slot lock to prevent race conditions
  const lockResult = await bookingPrevention.acquireSlotLock({
    tenantId,
    startAt: startTime.toISOString(),
    endAt: endTime.toISOString(),
    resourceId: payload.staff_id,
    lockDurationMinutes: 2, // Short lock for public booking
  });

  if (!lockResult.success) {
    if (lockResult.isConflict) {
      throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
    }
    throw ApiErrorFactory.internalServerError(new Error(lockResult.error || 'Failed to acquire booking lock'));
  }

  try {
    // Perform comprehensive conflict check with proper overlap detection.
    // When resourceIds is undefined (staff_id not provided), this performs a tenant-wide 
    // overlap check across all resources to ensure unassigned bookings don't conflict 
    // with any existing reservation in the time window.
    // When resourceIds is provided, it only checks for conflicts with that specific resource.
    const conflictCheck = await bookingPrevention.checkBookingConflicts({
      tenantId,
      startAt: startTime.toISOString(),
      endAt: endTime.toISOString(),
      resourceIds: payload.staff_id ? [payload.staff_id] : undefined,
    });

    if (conflictCheck.hasConflict) {
      throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
    }

    // Create booking atomically after conflict check passes
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
  } finally {
    // Always release the lock, even if an error occurs
    // Wrap in try/catch to prevent lock release errors from masking the original exception
    if (lockResult.lockId) {
      try {
        await bookingPrevention.releaseSlotLock(lockResult.lockId);
      } catch (releaseError) {
        // Log the release error but don't throw to preserve the original error
        console.error('Failed to release slot lock:', {
          lockId: lockResult.lockId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError)
        });
      }
    }
  }
}

/**
 * Helper: Generate available time slots
 */
function generateTimeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  existingReservations: Array<{ start_at: string; end_at: string }>,
  date: Date
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // Parse business hours
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  let current = new Date(date);
  current.setHours(startHour, startMin, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setHours(endHour, endMin, 0, 0);

  // Generate time slots at configured interval
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

    current = new Date(current.getTime() + SLOT_INTERVAL_MINUTES * 60000);
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
