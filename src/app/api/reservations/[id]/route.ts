import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { auditSuperadminAction } from '@/lib/enhanced-rbac';
import { parseIso } from '@/lib/utils';

/**
 * GET,PATCH,DELETE /api/reservations/[id]
 *
 * PATCH: Update a reservation (customer details, status, time)
 * DELETE: Cancel a reservation (soft delete via status='cancelled')
 *
 * Features:
 * - Conflict detection when rescheduling
 * - Audit logging of all changes
 * - Superadmin action tracking
 * - Metrics reporting (booking cancellation)
 *
 * Authorization: staff, manager, or owner role for tenant
 */

interface ReservationUpdatePayload {
  customer_name?: string;
  phone?: string;
  service?: any;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  start_at?: string;
  duration_minutes?: number;
}

export const PATCH = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params.id;
    if (!reservationId) {
      throw ApiErrorFactory.validationError({ id: 'Reservation ID is required' });
    }

    // Fetch existing reservation
    const { data: existing, error: existErr } = await ctx.supabase
      .from('reservations')
      .select('tenant_id, start_at, end_at, status')
      .eq('id', reservationId)
      .single();

    if (existErr) throw ApiErrorFactory.databaseError(existErr);
    if (!existing) throw ApiErrorFactory.notFound('Reservation');

    const { tenant_id: tenantId } = existing;

    // Verify tenant access
    if (ctx.user!.tenantId !== tenantId && ctx.user!.role !== 'superadmin') {
      throw ApiErrorFactory.insufficientPermissions(['staff', 'manager', 'owner']);
    }

    // Audit superadmin actions
    if (ctx.user!.role === 'superadmin') {
      await auditSuperadminAction(
        ctx.supabase,
        ctx.user!.id,
        'reservation_patch',
        tenantId,
        undefined,
        reservationId,
        { method: 'PATCH', reservationId },
        ctx.request.headers.get('x-forwarded-for') || '',
        ctx.request.headers.get('user-agent') || ''
      ).catch((err) => {
        console.warn('[api/reservations/[id]] Failed to audit superadmin action', err);
      });
    }

    const actor = { id: ctx.user!.id, role: ctx.user!.role };

    // Parse update payload
    const body = await parseJsonBody<ReservationUpdatePayload>(ctx.request);
    const updates: Record<string, any> = {};

    // Copy allowed fields
    const allowedFields: (keyof ReservationUpdatePayload)[] = ['customer_name', 'phone', 'service', 'status'];
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Handle time rescheduling with conflict detection
    if ('start_at' in body || 'duration_minutes' in body) {
      const startAtStr = body.start_at ?? existing.start_at;
      const start_at = parseIso(startAtStr);

      if (!start_at) {
        throw ApiErrorFactory.validationError({ start_at: 'Invalid or missing start_at format' });
      }

      const durationMin =
        body.duration_minutes ??
        (existing.end_at
          ? Math.round((new Date(existing.end_at).getTime() - new Date(existing.start_at).getTime()) / 60000)
          : 60);

      const s = new Date(start_at);
      const e = new Date(s.getTime() + durationMin * 60 * 1000);
      const newStartIso = s.toISOString();
      const newEndIso = e.toISOString();

      updates.start_at = newStartIso;
      updates.end_at = newEndIso;

      // Check for conflicts
      const { data: conflicts, error: confErr } = await ctx.supabase
        .from('reservations')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .neq('id', reservationId)
        .or(`and(start_at.lte.${newEndIso},end_at.gte.${newStartIso})`);

      if (confErr) throw ApiErrorFactory.databaseError(confErr);

      if (conflicts && conflicts.length > 0) {
        throw ApiErrorFactory.conflict('The requested time slot is unavailable');
      }
    }

    if (Object.keys(updates).length === 0) {
      throw ApiErrorFactory.validationError({ _: 'No update fields provided' });
    }

    // Apply updates
    const { data: updated, error: upErr } = await ctx.supabase
      .from('reservations')
      .update(updates)
      .eq('id', reservationId)
      .select('*')
      .single();

    if (upErr) throw ApiErrorFactory.databaseError(upErr);

    // Audit log
    try {
      const notes = JSON.stringify({
        updates,
        previous: { start_at: existing.start_at, end_at: existing.end_at, status: existing.status },
      });
      await ctx.supabase
        .from('reservation_logs')
        .insert({ reservation_id: reservationId, tenant_id: tenantId, action: 'update', actor, notes })
        .then(({ error: logErr }) => {
          if (logErr) console.warn('[api/reservations/[id]] Failed to insert update log:', logErr);
        });
    } catch (e) {
      console.warn('[api/reservations/[id]] Error writing update log:', e);
    }

    return updated;
  },
  'PATCH',
  { auth: true, roles: ['staff', 'manager', 'owner'] }
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params.id;
    if (!reservationId) {
      throw ApiErrorFactory.validationError({ id: 'Reservation ID is required' });
    }

    // Fetch existing reservation
    const { data: existing, error: existErr } = await ctx.supabase
      .from('reservations')
      .select('tenant_id, start_at, end_at, status')
      .eq('id', reservationId)
      .single();

    if (existErr) throw ApiErrorFactory.databaseError(existErr);
    if (!existing) throw ApiErrorFactory.notFound('Reservation');

    const { tenant_id: tenantId } = existing;

    // Verify tenant access
    if (ctx.user!.tenantId !== tenantId && ctx.user!.role !== 'superadmin') {
      throw ApiErrorFactory.insufficientPermissions(['staff', 'manager', 'owner']);
    }

    // Audit superadmin actions
    if (ctx.user!.role === 'superadmin') {
      await auditSuperadminAction(
        ctx.supabase,
        ctx.user!.id,
        'reservation_delete',
        tenantId,
        undefined,
        reservationId,
        { method: 'DELETE', reservationId },
        ctx.request.headers.get('x-forwarded-for') || '',
        ctx.request.headers.get('user-agent') || ''
      ).catch((err) => {
        console.warn('[api/reservations/[id]] Failed to audit superadmin action', err);
      });
    }

    const actor = { id: ctx.user!.id, role: ctx.user!.role };

    // Cancel reservation (soft delete)
    const { data, error } = await ctx.supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', reservationId)
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(error);

    // Record booking cancelled metric
    try {
      const { bookingCancelled } = await import('@/lib/metrics');
      bookingCancelled(tenantId);
    } catch (metricError) {
      console.warn('[api/reservations/[id]] Failed to record bookingCancelled metric:', metricError);
    }

    // Audit log
    try {
      const notes = `Cancelled by ${actor.role} (${ctx.user!.id})`;
      await ctx.supabase.from('reservation_logs').insert({
        reservation_id: reservationId,
        tenant_id: tenantId,
        action: 'cancel',
        actor,
        notes,
      }).then(({ error: logErr }) => {
        if (logErr) console.warn('[api/reservations/[id]] Failed to insert cancellation log:', logErr);
      });
    } catch (e) {
      console.warn('[api/reservations/[id]] Error writing cancellation log:', e);
    }

    return data;
  },
  'DELETE',
  { auth: true, roles: ['staff', 'manager', 'owner'] }
);
