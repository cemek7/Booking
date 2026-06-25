export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';
import { siasOperations } from '@/lib/sias-operations';

const ActionSchema = z.object({
  action: z.enum(['claim', 'resolve']),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const agentId = ctx.user?.id ?? null;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const id = ctx.params?.id;
    if (!id) {
      throw ApiErrorFactory.validationError({ id: 'Escalation ID required' });
    }

    const body = await ctx.request.json();
    const parsed = ActionSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const escalation = await siasOperations.updateEscalationTicket({
      tenantId,
      escalationId: id,
      action: parsed.data.action,
      agentId,
    });

    if (!escalation) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to update escalation'));
    }

    return { escalation };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
