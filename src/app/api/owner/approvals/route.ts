export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { listApprovalPolicies, listApprovalRequests, upsertApprovalPolicy } from '@/lib/approvals/requests';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const PolicySchema = z.object({
  request_type: z.enum(['discount', 'refund', 'stock_adjustment']),
  role: z.enum(['staff', 'manager']),
  max_self_approve: z.number().finite().min(0),
  requires_permission: z.string().min(1),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const url = new URL(ctx.request.url);
    const requests = await listApprovalRequests(ctx.supabase, tenantId, {
      status: url.searchParams.get('status') ?? undefined,
      requestType: url.searchParams.get('request_type') ?? undefined,
    });
    const policies = await listApprovalPolicies(ctx.supabase, tenantId);
    return { requests, policies };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const parsed = PolicySchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues));
    }
    const policies = await upsertApprovalPolicy(ctx.supabase, tenantId, parsed.data);
    return { policies };
  },
  'POST',
  { auth: true, roles: ['owner'], permissions: [BOOKA_PERMISSIONS.MANAGE_STAFF] }
);
