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
import {
  businessDayKey,
  localDateTimeToUtc,
  resolveBusinessHours,
  utcDayBounds,
  type BusinessHours,
  type DayKey,
  type LegacyBusinessHoursRow,
} from '@/lib/booking/businessHours';

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

const DAY_INDEX: Record<DayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

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

async function getTenantBookingContext(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  date: string,
): Promise<{ timezone: string; hours: BusinessHours; dayKey: DayKey }> {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('settings, metadata, timezone')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError) throw ApiErrorFactory.databaseError(new Error(tenantError.message));
  if (!tenant) throw ApiErrorFactory.notFound('Tenant');

  const timezone = typeof tenant.timezone === 'string' ? tenant.timezone : 'Africa/Lagos';
  const dayKey = businessDayKey(date, timezone);
  let legacyRows: LegacyBusinessHoursRow[] = [];

  try {
    const { data: legacy } = await supabase
      .from('business_hours')
      .select('day_of_week, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('day_of_week', DAY_INDEX[dayKey])
      .maybeSingle();
    if (legacy) legacyRows = [legacy as LegacyBusinessHoursRow];
  } catch {
    // A missing legacy table must not override canonical tenant settings.
  }

  return {
    timezone,
    dayKey,
    hours: resolveBusinessHours({
      settings: tenant.settings && typeof tenant.settings === 'object'
        ? tenant.settings as Record<string, unknown>
        : null,
      metadata: tenant.metadata && typeof tenant.metadata === 'object'
        ? tenant.metadata as Record<string, unknown>
        : null,
      legacyRows,
    }),
  };
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

  parseAvailabilityDate(date);

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

  const context = await getTenantBookingContext(supabase, tenantId, date);
  const dayHours = context.hours[context.dayKey];
  if (dayHours.closed || !dayHours.open || !dayHours.close) return [];
  const { startUtc, endUtc } = utcDayBounds(date, context.timezone);

  // Get existing reservations
  const { data: reservations, error: reservationsError } = await supabase
    .from('reservations')
    .select('start_at, end_at')
    .eq('tenant_id', tenantId)
    .lt('start_at', endUtc)
    .gt('end_at', startUtc)
    .in('status', ['confirmed', 'pending']);

  if (reservationsError) {
    throw ApiErrorFactory.databaseError(new Error(reservationsError.message));
  }

  // Generate slots
  const slots = generateTimeSlots(
    dayHours.open,
    dayHours.close,
    durationMinutes,
    reservations || [],
    date,
    context.timezone,
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
  parseAvailabilityDate(payload.date);
  
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

  const context = await getTenantBookingContext(supabase, tenantId, payload.date);
  const dayHours = context.hours[context.dayKey];
  if (dayHours.closed || !dayHours.open || !dayHours.close) {
    throw ApiErrorFactory.badRequest('Business is closed on the selected day');
  }

  let startTime: Date;
  try {
    startTime = new Date(localDateTimeToUtc(payload.date, payload.time, context.timezone));
  } catch {
    throw ApiErrorFactory.badRequest('Invalid date or time for this business timezone');
  }
  const endTime = new Date(startTime.getTime() + (service.duration_minutes || 60) * 60000);
  const openingTime = new Date(localDateTimeToUtc(payload.date, dayHours.open, context.timezone));
  const closingTime = new Date(localDateTimeToUtc(payload.date, dayHours.close, context.timezone));
  if (startTime < openingTime || endTime > closingTime) {
    throw ApiErrorFactory.badRequest('Selected time is outside business hours');
  }

  // Resolve the customer only after the requested local time has passed validation.
  const customer = await getCustomer(tenantId, payload);

  const bookingPrevention = new DoubleBookingPrevention(supabase);

  // Perform a friendly conflict pre-check. Migration 152's exclusion constraint
  // is the final authority if two requests pass this check concurrently.
  // When staff_id is absent, only other unassigned bookings conflict; assigned
  // staff may still have capacity.
  const conflictCheck = await bookingPrevention.checkBookingConflicts({
    tenantId,
    startAt: startTime.toISOString(),
    endAt: endTime.toISOString(),
    resourceIds: payload.staff_id ? [payload.staff_id] : undefined,
    checkUnassignedOnly: !payload.staff_id,
  });

  if (conflictCheck.hasConflict) {
    throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
  }

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
        booking_source: 'public_booking',
        timestamp: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (bookingErr?.code === '23P01') {
    throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
  }
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
}

/**
 * Helper: Generate available time slots
 */
function generateTimeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  existingReservations: Array<{ start_at: string; end_at: string }>,
  date: string,
  timezone: string,
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  let currentMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Generate 30-minute intervals
  while (currentMinutes + durationMinutes <= endMinutes) {
    const label = `${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}`;
    let current: Date;
    try {
      current = new Date(localDateTimeToUtc(date, label, timezone));
    } catch {
      currentMinutes += SLOT_INTERVAL_MINUTES;
      continue;
    }
    const slotEnd = new Date(current.getTime() + durationMinutes * 60000);

    // Check if slot overlaps with any reservation
    const isBooked = existingReservations.some(res => {
      const resStart = new Date(res.start_at);
      const resEnd = new Date(res.end_at);
      return current < resEnd && slotEnd > resStart;
    });

    slots.push({
      time: label,
      available: !isBooked,
    });

    currentMinutes += SLOT_INTERVAL_MINUTES;
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
