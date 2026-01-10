import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { generateCalendarLinks, bookingToCalendarEvent } from '@/lib/integrations/universalCalendar';
import { z } from 'zod';

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
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const body = await ctx.request.json();
    const validation = RequestBodySchema.safeParse(body);

    if (!validation.success) {
      throw ApiErrorFactory.badRequest('Invalid request body', validation.error.issues);
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

      calendarEvent = bookingToCalendarEvent({
        id: booking.id,
        service_name: booking.service?.name || 'Appointment',
        start_time: booking.start_at,
        end_time: booking.end_at,
        customer_name: booking.customer_name,
        customer_email: booking.customer_email,
        staff_name: booking.staff?.name,
        staff_email: booking.staff?.email,
        notes: booking.notes,
        tenant: {
          business_name: booking.tenant.business_name,
          contact_email: booking.tenant.contact_email,
        },
      });
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
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

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

    const calendarEvent = bookingToCalendarEvent({
      id: booking.id,
      service_name: booking.service?.name || 'Appointment',
      start_time: booking.start_at,
      end_time: booking.end_at,
      customer_name: booking.customer_name,
      customer_email: booking.customer_email,
      staff_name: booking.staff?.name,
      staff_email: booking.staff?.email,
      notes: booking.notes,
      tenant: {
        business_name: booking.tenant.business_name,
        contact_email: booking.tenant.contact_email,
      },
    });

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