export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { auditSuperadminAction } from '@/types/unified-permissions';
import { parseIso } from '@/lib/utils';
import { defaultLogger } from '@/lib/logger';
import { siasOperations } from '@/lib/sias-operations';
import { markReservationCompleted } from '@/lib/reconciliation/reservationSnapshot';

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
  service?: unknown;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  start_at?: string;
  duration_minutes?: number;
}

export const PATCH = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params!.id;
    if (!reservationId) {
      throw ApiErrorFactory.validationError({ id: 'Reservation ID is required' });
    }

    // Fetch existing reservation
    const { data: existing, error: existErr } = await ctx.supabase
      .from('reservations')
      .select('tenant_id, start_at, end_at, status')
      .eq('id', reservationId)
      .maybeSingle();

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
        defaultLogger.warn('[api/reservations/[id]] Failed to audit superadmin action', err);
      });
    }

    const actor = { id: ctx.user!.id, role: ctx.user!.role };

    // Parse update payload
    const body = await parseJsonBody<ReservationUpdatePayload>(ctx.request);
    const updates: Record<string, unknown> = {};

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
        // Overlap: start_at <= newEnd AND end_at >= newStart. Bind values via
        // chained filters instead of interpolating into an .or() string.
        .lte('start_at', newEndIso)
        .gte('end_at', newStartIso);

      if (confErr) throw ApiErrorFactory.databaseError(confErr);

      if (conflicts && conflicts.length > 0) {
        throw ApiErrorFactory.conflict('The requested time slot is unavailable');
      }
    }

    if (Object.keys(updates).length === 0) {
      throw ApiErrorFactory.validationError({ _: 'No update fields provided' });
    }

    let updated: Record<string, unknown> | null = null;
    const isCompletionTransition = updates.status === 'completed' && existing.status !== 'completed';

    if (isCompletionTransition) {
      const nonStatusUpdates = Object.fromEntries(
        Object.entries(updates).filter(([key]) => key !== 'status')
      );

      if (Object.keys(nonStatusUpdates).length > 0) {
        const { error: preUpdateError } = await ctx.supabase
          .from('reservations')
          .update(nonStatusUpdates)
          .eq('id', reservationId);

        if (preUpdateError) throw ApiErrorFactory.databaseError(preUpdateError);
      }

      // price_cents_snapshot frozen here — do not read live services.price for revenue (spec 1 §4.2)
      await markReservationCompleted(ctx.supabase, tenantId, reservationId, ctx.user!.id);

      const { data: refreshed, error: refreshedError } = await ctx.supabase
        .from('reservations')
        .select('*')
        .eq('id', reservationId)
        .single();

      if (refreshedError) throw ApiErrorFactory.databaseError(refreshedError);
      updated = refreshed as Record<string, unknown>;
    } else {
      const { data: refreshed, error: upErr } = await ctx.supabase
        .from('reservations')
        .update(updates)
        .eq('id', reservationId)
        .select('*')
        .single();

      if (upErr) throw ApiErrorFactory.databaseError(upErr);
      updated = refreshed as Record<string, unknown>;
    }

    // Audit log
    try {
      const notes = JSON.stringify({
        updates,
        previous: { start_at: existing.start_at, end_at: existing.end_at, status: existing.status },
      });
      await ctx.supabase
        .from('reservation_logs')
        .insert({ reservation_id: reservationId, tenant_id: tenantId, action: 'update', actor, notes })
        .then(({ error: logErr }: { error: unknown }) => {
          if (logErr) defaultLogger.warn('[api/reservations/[id]] Failed to insert update log:', logErr);
        });
    } catch (e) {
      defaultLogger.warn('[api/reservations/[id]] Error writing update log:', e);
    }

    if (updates.status === 'no_show') {
      await siasOperations.recordOutcomeAttribution({
        tenantId,
        reservationId: reservationId,
        sourceEvent: 'reservation.status.no_show',
        signal: 'no_show_reduction',
        value: 1,
        metadata: {
          previous_status: existing.status,
        },
      }).catch(() => undefined);

      await siasOperations.updateOperationalMemory({
        tenantId,
        memoryKey: 'no_show_patterns',
        memoryValue: {
          reservation_id: reservationId,
          marked_at: new Date().toISOString(),
        },
        source: 'reservation.status.no_show',
        confidence: 0.7,
      }).catch(() => undefined);
    }

    return updated;
  },
  'PATCH',
  { auth: true, roles: ['staff', 'manager', 'owner'] }
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params!.id;
    if (!reservationId) {
      throw ApiErrorFactory.validationError({ id: 'Reservation ID is required' });
    }

    // Fetch existing reservation
    const { data: existing, error: existErr } = await ctx.supabase
      .from('reservations')
      .select('tenant_id, start_at, end_at, status')
      .eq('id', reservationId)
      .maybeSingle();

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
        defaultLogger.warn('[api/reservations/[id]] Failed to audit superadmin action', err);
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
      defaultLogger.warn('[api/reservations/[id]] Failed to record bookingCancelled metric:', metricError);
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
      }).then(({ error: logErr }: { error: unknown }) => {
        if (logErr) defaultLogger.warn('[api/reservations/[id]] Failed to insert cancellation log:', logErr);
      });
    } catch (e) {
      defaultLogger.warn('[api/reservations/[id]] Error writing cancellation log:', e);
    }

    await siasOperations.recordCampaignRun({
      tenantId,
      campaignType: 'reactivation',
      action: 'send_reactivation',
      targetBookingId: reservationId,
      sourceEvent: 'reservation.cancelled',
      status: 'retry_scheduled',
      scheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      metadata: {
        cancellation_reason: 'cancelled via api',
      },
      attribution: {
        signal: 'revenue_recovery',
        source_event: 'reservation.cancelled',
      },
    }).catch(() => undefined);

    return data;
  },
  'DELETE',
  { auth: true, roles: ['staff', 'manager', 'owner'] }
);
