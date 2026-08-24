import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import {
  addOperatingDraftSource,
  approveOperatingDraft,
  getOperatingDraft,
  recordOperatingDraftAnswer,
  skipOperatingDraftQuestion,
} from '@/lib/onboarding/operating-draft';
import type { OperatingDraftView } from '@/lib/onboarding/operating-draft';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

const QuestionSchema = z.enum(['business_profile', 'offer', 'handoff', 'deposit', 'confirmation']);
const SourceTypeSchema = z.enum(['website', 'instagram', 'google_listing', 'whatsapp_export', 'price_list', 'other']);
const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('answer'), questionId: QuestionSchema, answer: z.string().trim().min(2).max(2000) }).strict(),
  z.object({ action: z.literal('skip'), questionId: QuestionSchema }).strict(),
  z.object({ action: z.literal('add_source'), sourceType: SourceTypeSchema, sourceReference: z.string().trim().min(1).max(2048) }).strict(),
  z.object({ action: z.literal('approve') }).strict(),
]);

async function recordReadiness(tenantId: string, actorId: string, action: string, draft: OperatingDraftView) {
  await captureServerAnalyticsEvent({
    event: ANALYTICS_EVENTS.OPERATING_ONBOARDING_READINESS_UPDATED,
    properties: { tenant_id: tenantId, channel: 'web', flow: 'activation', metadata: { action, ...draft.readiness, launch_ready: draft.launch?.ready === true } },
    distinctId: actorId,
  });
}

export const GET = createHttpHandler(
  async (ctx) => getOperatingDraft(getVerifiedTenantId(ctx)),
  'GET',
  { auth: true, roles: ['owner'] },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = ActionSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);

    const tenantId = getVerifiedTenantId(ctx);
    const actorId = ctx.user!.id;
    let draft: OperatingDraftView;
    switch (parsed.data.action) {
      case 'answer':
        draft = await recordOperatingDraftAnswer({ tenantId, actorId, questionId: parsed.data.questionId, answer: parsed.data.answer }); break;
      case 'skip':
        draft = await skipOperatingDraftQuestion({ tenantId, actorId, questionId: parsed.data.questionId }); break;
      case 'add_source':
        draft = await addOperatingDraftSource({
          tenantId, actorId, sourceType: parsed.data.sourceType, sourceReference: parsed.data.sourceReference,
        }); break;
      case 'approve':
        draft = await approveOperatingDraft({ tenantId, actorId }); break;
    }
    await recordReadiness(tenantId, actorId, parsed.data.action, draft);
    return draft;
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
