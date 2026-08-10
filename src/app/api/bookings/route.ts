export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { DoubleBookingPrevention } from '@/lib/doubleBookingPrevention';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createReservation } from '@/lib/reservationService';
import { routeStaff } from '@/lib/staffRouting';
import { generateCalendarLinks } from '@/lib/integrations/universalCalendar';
import type { BookingEvent } from '@/lib/integrations/universalCalendar';
import { z } from 'zod';
import { defaultLogger } from '@/lib/logger';
import { siasOperations } from '@/lib/sias-operations';
import type { UserRole } from '@/types/roles';

// Schema for GET request query parameters
const GetBookingsQuerySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  staff_id: z.string().uuid().optional(),
});

// Schema for POST request body
const CreateBookingBodySchema = z.object({
  customer_name: z.string().min(1),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  customer_id: z.string().uuid().optional(),
  customer_number: z.string().optional(),
  phone: z.string().optional(),
});

type ReservationResult = Awaited<ReturnType<typeof createReservation>>;
type CodedError = Error & { code?: string };

function getErrorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as CodedError).code : undefined;
}

/**
 * GET /api/bookings
 * Fetches bookings for a given time range and optional staff member.
 * Requires authentication and tenant access.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const queryValidation = GetBookingsQuerySchema.safeParse({
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
      staff_id: url.searchParams.get('staff_id') ?? undefined,
    });

    if (!queryValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid query parameters');
    }

    const { start, end, staff_id } = queryValidation.data;

    // Validate date range: start must be before end
    if (new Date(start) >= new Date(end)) {
      throw ApiErrorFactory.badRequest('start must be before end');
    }

    // Limit query range to 90 days to prevent expensive queries
    const maxRangeMs = 90 * 24 * 60 * 60 * 1000;
    if (new Date(end).getTime() - new Date(start).getTime() > maxRangeMs) {
      throw ApiErrorFactory.badRequest('Date range cannot exceed 90 days');
    }

    let query = ctx.supabase
      .from('reservations')
      .select('id, tenant_id, staff_id, start_at, end_at, status, service_id, customer_id, customer_name, customer_number, phone')
      .eq('tenant_id', ctx.user!.tenantId)
      .lt('start_at', end)
      .gt('end_at', start)
      .order('start_at', { ascending: true });

    if (staff_id) {
      query = query.eq('staff_id', staff_id);
    }

    const { data, error } = await query;

    if (error) {
      defaultLogger.error('Failed to fetch bookings:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch bookings'));
    }

    const bookings = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      start: row.start_at,
      end: row.end_at,
      status: row.status || 'confirmed',
      serviceId: row.service_id || 'unknown',
      staffId: row.staff_id,
      customer: {
        id: row.customer_id || row.customer_number || row.phone || row.customer_name || 'unknown',
        name: row.customer_name,
      },
      metadata: { tenantId: row.tenant_id },
    }));

    return { bookings };
  },
  'GET',
  { auth: true }
);

/**
 * POST /api/bookings
 * Creates a new booking for the user's tenant.
 * Requires authentication and tenant access.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = CreateBookingBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid request body');
    }

    const { start_at, end_at, staff_id, ...bookingData } = bodyValidation.data;
    const tenantId = ctx.user!.tenantId!;

    // A client-supplied staff_id must be a non-owner member of this tenant
    // (staff or manager). Owners aren't bookable staff; unknown ids are rejected.
    if (staff_id) {
      const { data: st } = await ctx.supabase.from('tenant_users')
        .select('user_id, role').eq('user_id', staff_id).eq('tenant_id', tenantId).maybeSingle();
      if (!st) throw ApiErrorFactory.validationError({ staff_id: 'Not found in this tenant' });
      if (st.role === 'owner') throw ApiErrorFactory.validationError({ staff_id: 'Owner cannot be assigned as booking staff' });
    }

    let resolvedStaffId = staff_id ?? null;

    // Use the admin client for locking so reservation_locks RLS does not block the operation.
    // tenantId is already server-verified from the authenticated session — no spoofing risk.
    const adminClient = createSupabaseAdminClient();
    const bookingPrevention = new DoubleBookingPrevention(adminClient);

    const lockResult = await bookingPrevention.acquireSlotLock({
      tenantId,
      startAt: start_at,
      endAt: end_at,
      resourceId: staff_id,
      lockDurationMinutes: 2,
    });

    if (!lockResult.success) {
      if (lockResult.isConflict) {
        throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
      }
      throw ApiErrorFactory.internalServerError(new Error(lockResult.error || 'Failed to acquire booking lock'));
    }

    // Auto-assign staff if not provided
    if (!resolvedStaffId) {
      const assigned = await routeStaff(
        adminClient, tenantId, 'preferred', start_at, end_at, {}
      ).catch(() => null);
      if (assigned) resolvedStaffId = assigned;
    }

    try {
      // Delegate to reservationService which handles conflict detection,
      // event emission, usage metrics, audit logs, and reminder scheduling.
      let reservation: ReservationResult;
      try {
        reservation = await createReservation(
          adminClient,
          {
            tenant_id: tenantId,
            customer_id: bookingData.customer_id ?? null,
            customer_name: bookingData.customer_name,
            phone: bookingData.phone,
            service_id: bookingData.service_id,
            service: bookingData.service_id,
            start_at,
            end_at,
            staff_id: resolvedStaffId,
            status: 'confirmed',
          },
          { id: ctx.user!.id, role: ctx.user!.role as UserRole }
        );
      } catch (err: unknown) {
        if (getErrorCode(err) === 'conflict') {
          await siasOperations.createEscalationTicket({
            tenantId,
            customerPhone: bookingData.phone ?? bookingData.customer_number ?? 'unknown',
            sessionId: `${tenantId}:${start_at}`,
            reason: 'double booking conflict',
            conversationSnapshot: [
              {
                event: 'booking.conflict',
                customer_name: bookingData.customer_name,
                phone: bookingData.phone ?? bookingData.customer_number ?? null,
                service_id: bookingData.service_id,
                start_at,
                end_at,
              },
            ],
          }).catch(() => undefined);
          throw ApiErrorFactory.conflict('Selected time slot is no longer available.');
        }
        if (getErrorCode(err) === '23505') {
          await siasOperations.createEscalationTicket({
            tenantId,
            customerPhone: bookingData.phone ?? bookingData.customer_number ?? 'unknown',
            sessionId: `${tenantId}:${start_at}`,
            reason: 'duplicate booking detected',
            conversationSnapshot: [
              {
                event: 'booking.conflict',
                customer_name: bookingData.customer_name,
                phone: bookingData.phone ?? bookingData.customer_number ?? null,
                service_id: bookingData.service_id,
                start_at,
                end_at,
              },
            ],
          }).catch(() => undefined);
          throw ApiErrorFactory.conflict('A conflicting booking already exists for this staff member at the selected time.');
        }
        throw err;
      }

      if (!reservation) {
        throw ApiErrorFactory.internalServerError(new Error('Failed to create booking'));
      }

      let calendarLinks: ReturnType<typeof generateCalendarLinks> | undefined;
      try {
        const calEvent: BookingEvent = {
          title: reservation.service || 'Booking',
          startTime: new Date(reservation.start_at),
          endTime: new Date(reservation.end_at),
          description: reservation.customer_name ? `Customer: ${reservation.customer_name}` : undefined,
        };
        calendarLinks = generateCalendarLinks(calEvent);
      } catch {}

      return NextResponse.json({ reservation, calendarLinks }, { status: 201 });
    } finally {
      if (lockResult.lockId) {
        await bookingPrevention.releaseSlotLock(lockResult.lockId).catch((e) => {
          defaultLogger.error('Failed to release booking lock:', e);
        });
      }
    }
  },
  'POST',
  { auth: true }
);
