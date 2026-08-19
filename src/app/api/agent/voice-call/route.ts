export const dynamic = 'force-dynamic';
/**
 * POST /api/agent/voice-call
 * Create a LiveKit call room and return a time-limited call link.
 * Requires Pro plan. Owner/manager only.
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createCallRoom } from '@/lib/voice/livekitService';
import { z } from 'zod';

const VoiceCallSchema = z.object({
  participantPhone: z.string().min(6, 'Phone number required'),
  ttlSeconds: z.number().int().min(60).max(3600).optional().default(600),
});

export const POST = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    // Check tenant plan
    const { data: tenant } = await ctx.supabase
      .from('tenants')
      .select('plan, metadata')
      .eq('id', tenantId)
      .maybeSingle();

    const plan = tenant?.plan ?? 'free';
    if (!['pro', 'business'].includes(plan)) {
      throw ApiErrorFactory.forbidden('Voice calls require a Pro plan or higher');
    }

    const meta = (tenant?.metadata ?? {}) as Record<string, unknown>;
    if (!meta['voice_calls_enabled']) {
      throw ApiErrorFactory.forbidden('Voice calls are not enabled for this account');
    }

    if (!process.env.LIVEKIT_URL) {
      throw ApiErrorFactory.forbidden('LiveKit is not configured on this server');
    }

    const body = await parseJsonBody(ctx.request);
    const { participantPhone, ttlSeconds } = VoiceCallSchema.parse(body);

    const room = await createCallRoom(tenantId, participantPhone, ttlSeconds);
    return room;
  },
  'POST',
  { auth: true }
);
