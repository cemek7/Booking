export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { bookingToCalendarEvent, generateCalendarLinks } from '@/lib/integrations/universalCalendar';

/**
 * POST /api/reservations/[id]/send-calendar
 *
 * Generates "add to calendar" links for a reservation and flags it as sent
 * (reservations.calendar_sent). Used by the ReservationForm "resend calendar"
 * action. Tenant-scoped.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params?.id;
    if (!reservationId) throw ApiErrorFactory.validationError({ id: 'Reservation id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const { data: reservation, error } = await ctx.supabase
      .from('reservations')
      .select('id, tenant_id, start_at, end_at, notes, customer_name, customer_number, service_id, duration')
      .eq('id', reservationId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw ApiErrorFactory.databaseError(error);
    if (!reservation) throw ApiErrorFactory.notFound('Reservation');

    const r = reservation as {
      start_at: string | null; end_at: string | null; notes: string | null;
      customer_name: string | null; customer_number: string | null;
      service_id: string | null; duration: number | null;
    };

    if (!r.start_at) throw ApiErrorFactory.validationError({ start_at: 'Reservation has no start time' });

    // Resolve service + tenant display info in parallel (best-effort).
    const [{ data: service }, { data: tenant }] = await Promise.all([
      r.service_id
        ? ctx.supabase.from('services').select('name').eq('id', r.service_id).eq('tenant_id', tenantId).maybeSingle()
        : Promise.resolve({ data: null }),
      ctx.supabase.from('tenants').select('name, settings').eq('id', tenantId).maybeSingle(),
    ]);

    const start = new Date(r.start_at);
    const durationMinutes = r.duration
      || (r.end_at ? Math.max(15, Math.round((new Date(r.end_at).getTime() - start.getTime()) / 60000)) : 60);
    const businessName = (tenant as { name?: string } | null)?.name || 'Booka';
    const contactEmail =
      ((tenant as { settings?: { contactEmail?: string } } | null)?.settings?.contactEmail) || '';

    const event = bookingToCalendarEvent({
      id: reservationId,
      service_name: (service as { name?: string } | null)?.name || 'Appointment',
      appointment_date: start.toISOString().slice(0, 10),
      appointment_time: start.toISOString().slice(11, 19),
      duration_minutes: durationMinutes,
      customer_name: r.customer_name || 'Customer',
      notes: r.notes || undefined,
      tenant: { business_name: businessName, contact_email: contactEmail },
    });

    const links = generateCalendarLinks(event);

    // Flag the reservation as having had its calendar sent.
    await ctx.supabase
      .from('reservations')
      .update({ calendar_sent: true, updated_at: new Date().toISOString() })
      .eq('id', reservationId)
      .eq('tenant_id', tenantId);

    return { success: true, links };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
