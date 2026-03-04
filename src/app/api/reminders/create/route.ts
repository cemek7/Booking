import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * POST /api/reminders/create
 * 
 * Create reminder records for a reservation. Automatically generates:
 * - 24-hour before reminder
 * - 2-hour before reminder
 * 
 * Request body: { reservation_id }
 */

export const POST = createHttpHandler(
  async (ctx) => {
    const { reservation_id } = await ctx.request.json();
    // Derive tenant from authenticated user; reject any header override
    const tenantId = ctx.user!.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (!reservation_id) throw ApiErrorFactory.badRequest('reservation_id required');

    // Fetch reservation details scoped to the user's tenant
    const { data: reservation, error: reservationError } = await ctx.supabase
      .from('reservations')
      .select('id,start_at,phone,customer_name')
      .eq('id', reservation_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (reservationError) throw ApiErrorFactory.internalServerError(new Error('Failed to fetch reservation'));
    if (!reservation) throw ApiErrorFactory.notFound('Reservation not found');
    if (!reservation.phone) throw ApiErrorFactory.badRequest('Reservation missing phone number for reminder');
    if (typeof reservation.start_at !== 'string') {
      throw ApiErrorFactory.internalServerError(new Error('Invalid reservation start time'));
    }

    // Calculate reminder times: 24 hours and 2 hours before start
    const startAt = new Date(reservation.start_at);
    const remind24 = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
    const remind2 = new Date(startAt.getTime() - 2 * 60 * 60 * 1000);

    const reminders = [
      {
        tenant_id: tenantId,
        reservation_id,
        remind_at: remind24.toISOString(),
        method: 'whatsapp',
        status: 'pending',
        raw: {
          to: reservation.phone,
          message: `Reminder: your booking is scheduled for ${reservation.start_at}`,
        },
      },
      {
        tenant_id: tenantId,
        reservation_id,
        remind_at: remind2.toISOString(),
        method: 'whatsapp',
        status: 'pending',
        raw: {
          to: reservation.phone,
          message: `Reminder: your booking is coming up at ${reservation.start_at}`,
        },
      },
    ];

    const { error } = await ctx.supabase.from('reminders').insert(reminders);
    if (error) throw ApiErrorFactory.internalServerError(new Error('Failed to create reminders'));

    return { created: reminders.length };
  },
  'POST',
  { auth: true }
);
