export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

type QueueStatus = 'pending' | 'processing' | 'retry' | 'failed' | 'completed';

function failureCategory(error: string | null | undefined): string | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (normalized.includes('openrouter') || normalized.includes('cloudflare') || normalized.includes('google ai') || normalized.includes('llm')) {
    return 'AI provider needs attention';
  }
  if (normalized.includes('token') || normalized.includes('oauth') || normalized.includes('permission')) {
    return 'Channel authorization needs attention';
  }
  if (normalized.includes('meta') || normalized.includes('whatsapp')) {
    return 'Channel delivery needs attention';
  }
  return 'Message processing needs attention';
}

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    if (ctx.user!.role !== 'superadmin' && ctx.user!.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const admin = createSupabaseAdminClient();
    const [connectionResult, pendingResult, processingResult, retryResult, failedResult, recentQueueResult, recentConversationResult] = await Promise.all([
      admin
        .from('whatsapp_configurations')
        .select('active, agent_enabled, meta_connection_status, meta_last_error, meta_last_validated_at, meta_webhook_subscribed_at')
        .eq('tenant_id', tenantId)
        .eq('provider', 'meta')
        .maybeSingle(),
      admin.from('whatsapp_message_queue').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('channel', 'whatsapp').eq('status', 'pending'),
      admin.from('whatsapp_message_queue').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('channel', 'whatsapp').eq('status', 'processing'),
      admin.from('whatsapp_message_queue').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('channel', 'whatsapp').eq('status', 'retry'),
      admin.from('whatsapp_message_queue').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('channel', 'whatsapp').eq('status', 'failed'),
      admin
        .from('whatsapp_message_queue')
        .select('status, created_at, processed_at, error_message')
        .eq('tenant_id', tenantId)
        .eq('channel', 'whatsapp')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('whatsapp_conversations')
        .select('last_inbound_at, flow_data')
        .eq('tenant_id', tenantId)
        .eq('channel', 'whatsapp')
        .not('last_inbound_at', 'is', null)
        .order('last_inbound_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (connectionResult.error) throw ApiErrorFactory.databaseError(connectionResult.error);
    const connection = connectionResult.data;
    if (!connection?.active) throw ApiErrorFactory.notFound('Active Meta WhatsApp connection');

    const queryErrors = [pendingResult, processingResult, retryResult, failedResult, recentQueueResult, recentConversationResult]
      .map((result) => result.error)
      .filter(Boolean);
    if (queryErrors.length > 0) throw ApiErrorFactory.databaseError(queryErrors[0]!);

    const recentQueue = recentQueueResult.data as {
      status?: QueueStatus;
      created_at?: string | null;
      processed_at?: string | null;
      error_message?: string | null;
    } | null;
    const flowData = (recentConversationResult.data?.flow_data ?? {}) as Record<string, unknown>;
    // Human takeover is conversation-scoped. This refers to the most recently
    // active customer conversation and must never be interpreted as a tenant-wide
    // automation kill switch.
    const humanHandlingUntil = typeof flowData.human_handling_until === 'string'
      ? flowData.human_handling_until
      : null;
    const humanHandling = humanHandlingUntil !== null && Date.parse(humanHandlingUntil) > Date.now();

    const recentFailure = recentQueue?.status === 'failed' || recentQueue?.status === 'retry'
      ? failureCategory(recentQueue.error_message)
      : failureCategory(connection.meta_last_error);

    return {
      connection: {
        status: connection.meta_connection_status ?? 'unknown',
        lastValidatedAt: connection.meta_last_validated_at ?? null,
        webhookSubscribedAt: connection.meta_webhook_subscribed_at ?? null,
      },
      automation: {
        agentEnabled: connection.agent_enabled === true,
        state: !connection.agent_enabled
          ? 'paused'
          : humanHandling
            ? 'human_handling'
            : recentFailure
              ? 'attention'
              : 'ready',
        humanHandlingUntil,
        lastInboundAt: recentConversationResult.data?.last_inbound_at ?? null,
        lastQueueActivityAt: recentQueue?.processed_at ?? recentQueue?.created_at ?? null,
        recentFailure,
      },
      queue: {
        pending: pendingResult.count ?? 0,
        processing: processingResult.count ?? 0,
        retrying: retryResult.count ?? 0,
        failed: failedResult.count ?? 0,
      },
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
