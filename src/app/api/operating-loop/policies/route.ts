import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { getPolicies, replacePolicies } from '@/lib/operating-loop/service';

const PolicySchema = z.object({
  name: z.string().trim().min(1).max(120),
  actionType: z.enum(['confirm_booking', 'collect_deposit', 'follow_up']),
  status: z.enum(['draft', 'active', 'paused', 'revoked']),
  eligibilityRules: z.record(z.string(), z.unknown()).optional(),
  quietHours: z.record(z.string(), z.unknown()).optional(),
}).strict();

const PoliciesSchema = z.object({
  automationPaused: z.boolean(),
  policies: z.array(PolicySchema).max(25),
}).strict();

export const dynamic = 'force-dynamic';

export const GET = createHttpHandler(
  async (ctx) => getPolicies(getVerifiedTenantId(ctx)),
  'GET',
  { auth: true, roles: ['owner'] },
);

export const PUT = createHttpHandler(
  async (ctx) => {
    const parsed = PoliciesSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    return replacePolicies({
      tenantId: getVerifiedTenantId(ctx),
      actorId: ctx.user!.id,
      automationPaused: parsed.data.automationPaused,
      policies: parsed.data.policies,
    });
  },
  'PUT',
  { auth: true, roles: ['owner'] },
);
