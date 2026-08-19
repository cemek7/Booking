export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { generateCalendarLinks, bookingToCalendarEvent } from '@/lib/integrations/universalCalendar';
import { z } from 'zod';

// Supabase infers relational joins (tenant/staff/service) as arrays, but with
// `.single()` on a to-one relation they are singular objects. This describes the
// actual runtime shape used to build the calendar event.
interface CalendarBookingRow {
  id: string;
  start_at: string;
  end_at: string;
  notes?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  tenant?: { business_name?: string | null; contact_email?: string | null } | null;
  staff?: { name?: string | null; email?: string | null } | null;
  service?: { name?: string | null; duration_minutes?: number | null } | null;
}

const CustomEventSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  timezone: z.string().optional(),
  organizer: z.object({ name: z.string(), email: z.string() }).optional(),
  attendees: z.array(z.object({ name: z.string(), email: z.string() })).optional(),
});

const RequestBodySchema = z.object({
  bookingId: z.string().uuid().optional(),
  customEvent: CustomEventSchema.optional(),
}).refine(data => data.bookingId || data.customEvent, {
  message: 'Either bookingId or customEvent must be provided',
});

/**
 * POST /api/calendar/universal
 * Generates universal "Add to Calendar" links for a booking or a custom event.
 * Requires authentication.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const body = await ctx.request.json();
    const validation = RequestBodySchema.safeParse(body);

    if (!validation.success) {
      throw ApiErrorFactory.badRequest('Invalid request body');
    }

    const { bookingId, customEvent } = validation.data;
    let calendarEvent;

    if (bookingId) {
      const { data: booking, error } = await ctx.supabase
        .from('reservations')
        .select(`
          id,
          start_at,
          end_at,
          notes,
          customer_name,
          customer_email,
          tenant:tenants (
            business_name,
            contact_email
          ),
          staff:staff (
            name,
            email
          ),
          service:services (
            name,
            duration_minutes
          )
        `)
        .eq('id', bookingId)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !booking) {
        throw ApiErrorFactory.notFound('Booking not found or access denied');
      }

      const b = booking as unknown as CalendarBookingRow;
      calendarEvent = bookingToCalendarEvent({
        id: b.id,
        service_name: b.service?.name || 'Appointment',
        appointment_date: b.start_at.split('T')[0],
        appointment_time: b.start_at.split('T')[1]?.substring(0, 5) || '00:00',
        duration_minutes: b.service?.duration_minutes ||
          Math.round((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000),
        customer_name: b.customer_name,
        customer_email: b.customer_email,
        staff_name: b.staff?.name,
        staff_email: b.staff?.email,
        notes: b.notes,
        tenant: {
          business_name: b.tenant?.business_name,
          contact_email: b.tenant?.contact_email,
        },
      } as Parameters<typeof bookingToCalendarEvent>[0]);
    } else if (customEvent) {
      calendarEvent = {
        title: customEvent.title,
        description: customEvent.description,
        location: customEvent.location,
        startTime: new Date(customEvent.startTime),
        endTime: new Date(customEvent.endTime),
        timezone: customEvent.timezone,
        organizer: customEvent.organizer,
        attendees: customEvent.attendees,
      };
    } else {
      throw ApiErrorFactory.badRequest('Either bookingId or customEvent is required');
    }

    const calendarLinks = generateCalendarLinks(calendarEvent);

    return {
      success: true,
      event: calendarEvent,
      links: calendarLinks,
    };
  },
  'POST',
  { auth: true }
);

/**
 * GET /api/calendar/universal?bookingId=123
 * Quick access to generate calendar links for a specific booking
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const bookingId = ctx.request.nextUrl.searchParams.get('bookingId');

    if (!bookingId) {
      throw ApiErrorFactory.badRequest('bookingId query parameter is required');
    }

    const { data: booking, error } = await ctx.supabase
      .from('reservations')
      .select(`
        id,
        start_at,
        end_at,
        notes,
        customer_name,
        customer_email,
        tenant:tenants (
          business_name,
          contact_email
        ),
        staff:staff (
          name,
          email
        ),
        service:services (
          name,
          duration_minutes
        )
      `)
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !booking) {
      throw ApiErrorFactory.notFound('Booking not found or access denied');
    }

    const b = booking as unknown as CalendarBookingRow;
    const calendarEvent = bookingToCalendarEvent({
      id: b.id,
      service_name: b.service?.name || 'Appointment',
      appointment_date: b.start_at.split('T')[0],
      appointment_time: b.start_at.split('T')[1]?.substring(0, 5) || '00:00',
      duration_minutes: b.service?.duration_minutes ||
        Math.round((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000),
      customer_name: b.customer_name,
      customer_email: b.customer_email,
      staff_name: b.staff?.name,
      staff_email: b.staff?.email,
      notes: b.notes,
      tenant: {
        business_name: b.tenant?.business_name,
        contact_email: b.tenant?.contact_email,
      },
    } as Parameters<typeof bookingToCalendarEvent>[0]);

    const calendarLinks = generateCalendarLinks(calendarEvent);

    return {
      success: true,
      event: calendarEvent,
      links: calendarLinks,
    };
  },
  'GET',
  { auth: true }
);