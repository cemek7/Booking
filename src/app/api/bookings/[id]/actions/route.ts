export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

/**
 * POST /api/bookings/[id]/actions
 *
 * Applies a lifecycle action to a booking (reservation):
 *   confirm     → status = 'confirmed'
 *   cancel      → status = 'cancelled'
 *   mark_paid   → metadata.payment_status = 'paid'
 *   reschedule  → start_at/end_at from payload
 *
 * "Booking id" is a reservation id (the /api/bookings facade over reservations).
 */
const ActionSchema = z.object({
  action: z.enum(['confirm', 'cancel', 'reschedule', 'mark_paid']),
  payload: z
    .object({
      start_at: z.string().optional(),
      end_at: z.string().optional(),
      duration_minutes: z.number().int().positive().max(24 * 60).optional(),
    })
    .partial()
    .optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params?.id;
    if (!reservationId) throw ApiErrorFactory.validationError({ id: 'Booking id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const parsed = ActionSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }
    const { action, payload } = parsed.data;

    // Load the reservation and confirm tenant ownership.
    const { data: existing, error: loadErr } = await ctx.supabase
      .from('reservations')
      .select('id, tenant_id, start_at, metadata')
      .eq('id', reservationId)
      .maybeSingle();
    if (loadErr) throw ApiErrorFactory.databaseError(loadErr);
    if (!existing) throw ApiErrorFactory.notFound('Booking not found');
    if ((existing as { tenant_id?: string }).tenant_id !== tenantId) {
      throw ApiErrorFactory.forbidden('Booking belongs to another tenant');
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (action === 'confirm') {
      update.status = 'confirmed';
    } else if (action === 'cancel') {
      update.status = 'cancelled';
    } else if (action === 'mark_paid') {
      const meta = ((existing as { metadata?: Record<string, unknown> }).metadata) ?? {};
      update.metadata = { ...meta, payment_status: 'paid', paid_at: new Date().toISOString() };
    } else if (action === 'reschedule') {
      const startIso = payload?.start_at;
      if (!startIso) {
        throw ApiErrorFactory.validationError({ 'payload.start_at': 'A new start time is required to reschedule' });
      }
      const start = new Date(startIso);
      if (Number.isNaN(start.getTime())) {
        throw ApiErrorFactory.validationError({ 'payload.start_at': 'Invalid start time' });
      }
      update.start_at = start.toISOString();
      if (payload?.end_at) {
        update.end_at = new Date(payload.end_at).toISOString();
      } else if (payload?.duration_minutes) {
        update.end_at = new Date(start.getTime() + payload.duration_minutes * 60_000).toISOString();
      }
      update.status = 'confirmed';
    }

    const { data: updated, error: updErr } = await ctx.supabase
      .from('reservations')
      .update(update)
      .eq('id', reservationId)
      .eq('tenant_id', tenantId)
      .select('id, status, start_at, end_at, metadata')
      .maybeSingle();

    if (updErr) throw ApiErrorFactory.databaseError(updErr);

    return { success: true, booking: updated };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
