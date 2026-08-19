export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getPaymentService } from '@/lib/payments/lifecycle';

/**
 * GET /api/payments/tracking?staleMinutes=30
 *
 * Ops view of a tenant's payments: live (pending/processing), hanging (live but
 * stuck), and failed transactions. Owner/manager only, tenant-scoped.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const url = new URL(ctx.request.url);
    const staleMinutes = Math.min(Math.max(Number(url.searchParams.get('staleMinutes')) || 30, 1), 24 * 60);

    const tracking = await getPaymentService().getPaymentTracking(tenantId, { staleMinutes });

    return {
      staleMinutes,
      counts: {
        live: tracking.live.length,
        hanging: tracking.hanging.length,
        failed: tracking.failed.length,
      },
      ...tracking,
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
