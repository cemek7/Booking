export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { exportCustomerData } from '@/lib/dsar/export';
import { eraseCustomerData } from '@/lib/dsar/erase';
import { writeAuditLog } from '@/lib/audit/log';

/** Resolve + tenant-guard the route params. */
function resolveParams(ctx: { params?: Record<string, string>; user?: { tenantId?: string } }) {
  const tenantId = ctx.params?.tenantId;
  const customerId = ctx.params?.customerId;
  if (!tenantId || !customerId) {
    throw ApiErrorFactory.validationError({ params: 'tenantId and customerId are required' });
  }
  if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
    throw ApiErrorFactory.forbidden('Access denied to this tenant');
  }
  return { tenantId, customerId };
}

/**
 * GET /api/tenants/[tenantId]/customers/[customerId]/dsar
 * Data-subject access request: export everything held about one customer.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const { tenantId, customerId } = resolveParams(ctx);
    const admin = createSupabaseAdminClient();
    const data = await exportCustomerData(admin, { tenantId, customerId });
    await writeAuditLog(admin, {
      action: 'customer.dsar.export',
      tenantId,
      userId: ctx.user?.id,
      userRole: ctx.user?.role,
      result: 'success',
      metadata: { customerId },
    });
    return { success: true, export: data };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] },
);

/**
 * POST /api/tenants/[tenantId]/customers/[customerId]/dsar
 * Right-to-erasure. Body { confirm?: boolean }.
 * Without confirm:true returns the dry-run plan; with confirm:true performs the erase.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const { tenantId, customerId } = resolveParams(ctx);
    const body = await parseJsonBody<{ confirm?: boolean }>(ctx.request).catch(() => ({}));
    const dryRun = body?.confirm !== true;

    const admin = createSupabaseAdminClient();
    const report = await eraseCustomerData(admin, { tenantId, customerId, dryRun });
    await writeAuditLog(admin, {
      action: dryRun ? 'customer.dsar.erase.dryrun' : 'customer.dsar.erase',
      tenantId,
      userId: ctx.user?.id,
      userRole: ctx.user?.role,
      result: 'success',
      metadata: { customerId, dryRun, actions: report.actions },
    });
    return { success: true, report };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);
