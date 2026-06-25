export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';
import { defaultLogger } from '@/lib/logger';
import { siasOperations } from '@/lib/sias-operations';

const CreateEscalationSchema = z.object({
  customerPhone: z.string().min(1),
  sessionId: z.string().min(1),
  reason: z.string().min(1),
  assignedAgentId: z.string().uuid().optional(),
  conversationSnapshot: z.array(z.any()).optional(),
  status: z.enum(['pending', 'claimed', 'resolved', 'timed_out']).optional(),
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
      defaultLogger.error('[api/escalation] GET error:', error.message);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch escalation queue'));
    }

    return { escalations: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * POST /api/escalation
 * Create a new escalation ticket from an app event or manual operator action.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const body = await ctx.request.json();
    const parsed = CreateEscalationSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const escalation = await siasOperations.createEscalationTicket({
      tenantId,
      customerPhone: parsed.data.customerPhone,
      sessionId: parsed.data.sessionId,
      reason: parsed.data.reason,
      assignedAgentId: parsed.data.assignedAgentId ?? null,
      conversationSnapshot: parsed.data.conversationSnapshot ?? [],
      status: parsed.data.status ?? 'pending',
    });

    if (!escalation) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to create escalation ticket'));
    }

    return { escalation };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
