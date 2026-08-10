/**
 * Public Booking API Routes
 * No authentication required - for public-facing booking
 * 
 * Timezone Handling:
 * - All dates are handled in the server's timezone
 * - Clients should send dates in ISO 8601 format or ensure timezone compatibility
 * - Business hours are stored in the tenant's local timezone
 */

import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import type { TimeSlot } from '@/types';
import { DoubleBookingPrevention } from '@/lib/doubleBookingPrevention';
import PaymentService from '@/lib/paymentService';
import { resolveCustomer } from '@/lib/customers/identity';

export interface BookingDepositInfo {
  depositRequired: boolean;
  paymentUrl?: string | null;
  depositAmountCents?: number;
  currency?: string;
}

/**
 * If the tenant requires a deposit, initialise a Paystack payment for
 * depositPercent% of the service price and return the checkout URL. Never
 * throws — a booking is always created; a failed/absent deposit just means the
 * owner follows up. The webhook (handlePaymentSuccess) confirms the reservation
 * on payment via the transaction's subject_id.
 */
async function maybeCreateBookingDeposit(input: {
  tenantId: string;
  reservationId: string;
  serviceId?: string;
  email?: string;
  callbackUrl?: string | null;
}): Promise<BookingDepositInfo> {
  try {
    if (!input.serviceId || !input.email) return { depositRequired: false };
    const supabase = createSupabaseAdminClient();

    const { data: tenant } = await supabase
      .from('tenants')
      .select('settings, metadata')
      .eq('id', input.tenantId)
      .maybeSingle();
    const settings = (tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {}) as Record<string, unknown>;
    const metadata = (tenant?.metadata && typeof tenant.metadata === 'object' ? tenant.metadata : {}) as Record<string, unknown>;
    const uiSettings = (metadata.ui_settings && typeof metadata.ui_settings === 'object' ? metadata.ui_settings : {}) as Record<string, unknown>;

    const requireDeposit = (settings.requireDeposit ?? uiSettings.requireDeposit) === true;
    const depositPercent = Number(settings.depositPercent ?? uiSettings.depositPercent ?? 0);
    if (!requireDeposit || !(depositPercent > 0)) return { depositRequired: false };

    const currency = String(settings.defaultCurrency ?? uiSettings.defaultCurrency ?? 'NGN');

    const { data: service } = await supabase
      .from('services')
      .select('price_cents, price')
      .eq('id', input.serviceId)
      .maybeSingle();
    const priceCents = typeof service?.price_cents === 'number'
      ? service.price_cents
      : (typeof service?.price === 'number' ? Math.round(service.price * 100) : 0);
    const depositMinor = Math.round((priceCents * depositPercent) / 100);
    if (!(depositMinor > 0)) return { depositRequired: false };

    const subaccountCode = typeof metadata.paystack_subaccount_code === 'string'
      ? metadata.paystack_subaccount_code
      : undefined;

    const paymentService = new PaymentService(supabase);
    const result = await paymentService.initializePayment({
      tenantId: input.tenantId,
      amount: depositMinor,
      currency,
      email: input.email,
      reservationId: input.reservationId,
      provider: 'paystack',
      metadata: { type: 'deposit', reservation_id: input.reservationId },
      subaccountCode,
      bearer: 'account',
      callbackUrl: input.callbackUrl ?? undefined,
    });

    if (result.success && result.authorizationUrl) {
      return { depositRequired: true, paymentUrl: result.authorizationUrl, depositAmountCents: depositMinor, currency };
    }
    defaultLogger.warn('[publicBooking] deposit init failed; booking left pending', { reservationId: input.reservationId, error: result.error });
    return { depositRequired: false };
  } catch (err) {
    defaultLogger.warn('[publicBooking] deposit init threw; booking left pending', { error: err instanceof Error ? err.message : String(err) });
    return { depositRequired: false };
  }
}

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

  throw ApiErrorFactory.badRequest('Invalid date format');
}

/**
 * GET /api/public/[slug]
 * Get public tenant information
 */
export async function getTenantPublicInfo(slug: string) {
  const supabase = createSupabaseAdminClient();

  // `description`, `logo_url` and `settings` are NOT columns on `tenants` — they
  // live inside the `metadata` jsonb. Selecting them directly makes PostgREST
  // error the whole query, which surfaced as a 404 on every public booking page.
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, slug, industry, metadata')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !tenant) {
    throw ApiErrorFactory.notFound('Tenant');
  }

  const metadata = (tenant.metadata ?? {}) as Record<string, unknown>;
  const uiSettings = (metadata.ui_settings ?? {}) as Record<string, unknown>;

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    description:
      (metadata.description as string | undefined) ??
      (uiSettings.description as string | undefined) ??
      undefined,
    logo:
      (metadata.logo_url as string | undefined) ??
      (uiSettings.logo_url as string | undefined) ??
      undefined,
    industry: tenant.industry,
    settings: uiSettings,
  };
}

/**
 * GET /api/public/[slug]/services
 * Get available services for tenant
 */
export async function getTenantServices(tenantId: string) {
  const supabase = createSupabaseAdminClient();

  const { data: services, error } = await supabase
    .from('services')
    .select(`
      id,
      name,
      description,
      duration_minutes,
      price_cents,
      image_url,
      category
    `)
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (error) {
    throw ApiErrorFactory.databaseError(new Error(error.message));
  }

  return (services || []).map((service: Record<string, unknown>) => {
    const duration = typeof service.duration_minutes === 'number'
      ? service.duration_minutes
      : Number(service.duration_minutes ?? 30);
    const price = typeof service.price_cents === 'number'
      ? service.price_cents
      : Number(service.price_cents ?? 0);

    return {
      ...service,
      duration: Number.isFinite(duration) ? duration : 30,
      duration_minutes: Number.isFinite(duration) ? duration : 30,
      price: Number.isFinite(price) ? price : 0,
      price_cents: Number.isFinite(price) ? price : 0,
    };
  });
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
  void _staffId;
  const supabase = createSupabaseAdminClient();

  // Date is interpreted in the server timezone. Clients should send YYYY-MM-DD in the tenant's timezone.
  const targetDate = parseAvailabilityDate(date);
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Get service duration
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .maybeSingle();

  if (serviceError) {
    throw ApiErrorFactory.databaseError(new Error(serviceError.message));
  }

  if (!service) {
    throw ApiErrorFactory.notFound('Service');
  }

  const durationMinutes = service.duration_minutes || 60;

  // Business hours: the `business_hours` table is not present in the deployed
  // schema yet. Read it if it exists, otherwise fall back to a sensible default
  // window so customers can still book (a 500 here would block all bookings).
  // TODO(launch-follow-up): create business_hours + a settings UI for real hours.
  const DEFAULT_START = '09:00:00';
  const DEFAULT_END = '17:00:00';
  let startTime = DEFAULT_START;
  let endTime = DEFAULT_END;
  try {
    const { data: hours, error: hoursError } = await supabase
      .from('business_hours')
      .select('start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('day_of_week', targetDate.getDay())
      .maybeSingle();
    if (!hoursError && hours?.start_time && hours?.end_time) {
      startTime = hours.start_time;
      endTime = hours.end_time;
    }
    // hoursError (e.g. table missing) or no row -> keep the default window.
  } catch {
    // keep the default window
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
    startTime,
    endTime,
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
  const admin = createSupabaseAdminClient();

  const customerId = await resolveCustomer(admin, tenantId, payload.customer_phone, {
    name: payload.customer_name,
    email: payload.customer_email,
    source: 'public_booking',
  });

  if (!customerId) {
    throw ApiErrorFactory.databaseError(new Error('Failed to resolve customer'));
  }

  return { id: customerId };
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
  },
  opts?: { callbackUrl?: string | null }
) {
  const supabase = createSupabaseAdminClient();

  // Get or create customer
  const customer = await getCustomer(tenantId, payload);

  // Parse start time and validate
  const startTime = new Date(`${payload.date}T${payload.time}`);
  
  if (isNaN(startTime.getTime())) {
    throw ApiErrorFactory.badRequest('Invalid date or time format');
  }
  
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', payload.service_id)
    .maybeSingle();

  if (serviceError) {
    throw ApiErrorFactory.databaseError(new Error(serviceError.message));
  }

  if (!service) {
    throw ApiErrorFactory.notFound('Service');
  }

  const endTime = new Date(startTime.getTime() + (service.duration_minutes || 60) * 60000);

  // Use DoubleBookingPrevention service for transactionally safe conflict detection
  // Use admin client to bypass RLS on reservation_locks table, as this is a public endpoint
  // operating with anon role which would otherwise fail on RLS policies.
  // SECURITY NOTE: The admin client bypasses ALL RLS policies, but DoubleBookingPrevention
  // is designed to only access reservation_locks and reservations tables. Future: consider
  // creating a more restricted service role or using function-level RLS bypass.
  const adminClient = createSupabaseAdminClient();
  const bookingPrevention = new DoubleBookingPrevention(adminClient);
  
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
    // The reservation_locks table is absent in the deployed schema, so the
    // distributed lock is unavailable. Do NOT fail the booking — the
    // reservations-based conflict check below still guards against double
    // bookings (slightly wider race window until reservation_locks exists).
    // TODO(launch-follow-up): create reservation_locks for full race safety.
    defaultLogger.warn('createPublicBooking: slot lock unavailable, proceeding with conflict check only', {
      error: lockResult.error,
    });
  }

  try {
    // Perform comprehensive conflict check with proper overlap detection.
    // 
    // BUSINESS LOGIC: Conflict scope behavior
    // - When staff_id IS provided: Checks conflicts only for that specific staff member,
    //   allowing multiple staff to be booked simultaneously.
    // 
    // - When staff_id IS NOT provided: Checks conflicts only with OTHER unassigned bookings
    //   (where staff_id IS NULL). This allows unassigned bookings even when some staff members
    //   are busy, since the booking can later be assigned to any available staff member.
    //   This is more permissive than a tenant-wide check and appropriate for multi-staff systems.
    const conflictCheck = await bookingPrevention.checkBookingConflicts({
      tenantId,
      startAt: startTime.toISOString(),
      endAt: endTime.toISOString(),
      resourceIds: payload.staff_id ? [payload.staff_id] : undefined,
      checkUnassignedOnly: !payload.staff_id, // Only check unassigned when no staff specified
    });

    if (conflictCheck.hasConflict) {
      throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
    }

    // Create booking atomically after conflict check passes
    // Use adminClient (same client as lock/conflict check) for atomicity
    const { data: booking, error: bookingErr } = await adminClient
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
          booking_source: 'public_booking',
          timestamp: new Date().toISOString(),
        },
      })
      .select('id')
      .single();

    if (bookingErr || !booking) {
      throw ApiErrorFactory.databaseError(new Error(bookingErr?.message || 'Failed to create booking'));
    }

    // If the tenant requires a deposit, mint a Paystack checkout for it. The
    // reservation stays 'pending' until the webhook confirms payment.
    const deposit = await maybeCreateBookingDeposit({
      tenantId,
      reservationId: booking.id,
      serviceId: payload.service_id,
      email: payload.customer_email,
      callbackUrl: opts?.callbackUrl ?? null,
    });

    return { id: booking.id, ...deposit };
  } finally {
    // Always release the lock, even if an error occurs
    // Wrap in try/catch to prevent lock release errors from masking the original exception
    if (lockResult.lockId) {
      try {
        await bookingPrevention.releaseSlotLock(lockResult.lockId);
      } catch (releaseError) {
        // Log the release error but don't throw to preserve the original error
        defaultLogger.error('Failed to release slot lock:', {
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
  targetDate: Date
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // Parse business hours
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  let current = new Date(targetDate);
  current.setHours(startHour, startMin, 0, 0);

  const dayEnd = new Date(targetDate);
  dayEnd.setHours(endHour, endMin, 0, 0);

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
