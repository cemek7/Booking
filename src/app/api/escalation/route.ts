import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const ClaimSchema = z.object({
  action: z.enum(['claim', 'resolve']),
});

/**
 * GET /api/escalation
 * List pending escalation tickets for the authenticated user's tenant.
 * Optional ?status=pending|claimed|resolved query param.
 * Requires auth (role: owner, manager, staff).
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status') || 'pending';

    const { data, error } = await ctx.supabase
      .from('escalation_queue')
      .select('id, customer_phone, session_id, reason, status, assigned_agent_id, conversation_snapshot, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[api/escalation] GET error:', error.message);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch escalation queue'));
    }

    return { escalations: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * PATCH /api/escalation/:id
 * Claim or resolve an escalation ticket.
 * Body: { action: 'claim' | 'resolve' }
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const agentId = ctx.user?.id;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    // Extract escalation ID from URL path
    const segments = new URL(ctx.request.url).pathname.split('/');
    const escalationId = segments[segments.indexOf('escalation') + 1];
    if (!escalationId) throw ApiErrorFactory.validationError({ id: 'Escalation ID required in URL' });

    const body = await ctx.request.json();
    const parsed = ClaimSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const { action } = parsed.data;

    const updates: Record<string, unknown> =
      action === 'claim'
        ? { status: 'claimed', assigned_agent_id: agentId }
        : { status: 'resolved', resolved_at: new Date().toISOString() };

    const { data, error } = await ctx.supabase
      .from('escalation_queue')
      .update(updates)
      .eq('id', escalationId)
      .eq('tenant_id', tenantId)
      .select('id, status, assigned_agent_id, resolved_at')
      .single();

    if (error) {
      console.error('[api/escalation] PATCH error:', error.message);
      throw ApiErrorFactory.internalServerError(new Error('Failed to update escalation'));
    }

    return { escalation: data };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
