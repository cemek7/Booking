export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * GET /api/reservations/[id]/services
 *
 * Returns the services attached to a reservation, resolved to human-readable
 * names (not raw service UUIDs). Tenant-scoped: only services for the caller's
 * tenant are returned.
 *
 * Response: Array<{ service_id, name, quantity, price }>
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params?.id;
    if (!reservationId) {
      throw ApiErrorFactory.validationError({ id: 'Reservation ID is required' });
    }

    const tenantId = ctx.user!.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant context required');
    }

    // Line items for this reservation, scoped to the caller's tenant.
    const { data: links, error: linkErr } = await ctx.supabase
      .from('reservation_services')
      .select('service_id, quantity')
      .eq('reservation_id', reservationId)
      .eq('tenant_id', tenantId);

    if (linkErr) {
      throw ApiErrorFactory.databaseError(linkErr);
    }

    const rows = (links ?? []) as Array<{ service_id: string; quantity: number | null }>;
    if (rows.length === 0) {
      return [];
    }

    // Resolve service names in one query.
    const serviceIds = Array.from(new Set(rows.map((r) => r.service_id).filter(Boolean)));
    const { data: services, error: svcErr } = await ctx.supabase
      .from('services')
      .select('id, name, price')
      .eq('tenant_id', tenantId)
      .in('id', serviceIds);

    if (svcErr) {
      throw ApiErrorFactory.databaseError(svcErr);
    }

    const byId = new Map(
      ((services ?? []) as Array<{ id: string; name: string | null; price: number | null }>).map((s) => [s.id, s])
    );

    return rows.map((r) => {
      const svc = byId.get(r.service_id);
      return {
        service_id: r.service_id,
        name: svc?.name || 'Service',
        quantity: r.quantity ?? 1,
        price: svc?.price ?? null,
      };
    });
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
