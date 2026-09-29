export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { chatMessagesSent } from '@/lib/metrics';
import { trace } from '@opentelemetry/api';
import { getTenantChannelProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { setHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';
import { computeOutboundReadiness } from '@/lib/chats/outboundReadiness';
import { sendOutboundOnce } from '@/lib/whatsapp/v2/outboundDelivery';
import { createHash, randomUUID } from 'crypto';

const PostMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'Message text cannot be empty'),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

/**
 * POST /api/chats/{id}/messages
 * Sends a new message in a chat.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tracer = trace.getTracer('boka-api');
    const span = tracer.startSpan('chat.message.send');

    try {
      const chatId = ctx.params?.id;
      if (!chatId) {
        throw ApiErrorFactory.validationError({ id: 'Chat ID is required' });
      }
      span.setAttribute('chat.id', chatId);

      const body = await ctx.request.json();
      const bodyValidation = PostMessageBodySchema.safeParse(body);
      if (!bodyValidation.success) {
        throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
      }
      const { text } = bodyValidation.data;

      // Fetch the chat to verify it exists and get its tenant_id
      const { data: chat, error: chatError } = await ctx.supabase
        .from('chats')
        .select('id, tenant_id, customer_phone, metadata')
        .eq('id', chatId)
        .single();

      if (chatError || !chat) {
        span.setAttribute('chat.found', false);
        throw ApiErrorFactory.notFound('Chat');
      }
      span.setAttribute('tenant.id', chat.tenant_id);
      const channel = chat.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp';
      span.setAttribute('chat.channel', channel);

      // Verify user has access to this tenant's chat
      if (ctx.user?.tenantId && ctx.user.tenantId !== chat.tenant_id) {
        throw ApiErrorFactory.forbidden('Access denied to this chat');
      }
      span.setAttribute('auth.authorized', true);

      if (!chat.customer_phone) {
        throw ApiErrorFactory.validationError({ customer_phone: 'Chat recipient is missing' });
      }

      const readiness = await computeOutboundReadiness(ctx.supabase as never, {
        tenantId: chat.tenant_id,
        externalId: chat.customer_phone,
        channel,
      });

      if (!readiness.allowed) {
        throw ApiErrorFactory.accountLocked(readiness.reason);
      }

      const { data: conversation, error: conversationError } = await ctx.supabase
        .from('whatsapp_conversations')
        .select('active_thread_id')
        .eq('tenant_id', chat.tenant_id)
        .eq('channel', channel)
        .eq('external_id', chat.customer_phone)
        .maybeSingle();
      if (conversationError) throw ApiErrorFactory.databaseError(conversationError);
      if (!conversation?.active_thread_id) {
        throw ApiErrorFactory.validationError({ conversation: 'Chat has no active conversation thread' });
      }
      const threadId = String(conversation.active_thread_id);

      await setHumanHandling({
        externalId: chat.customer_phone,
        tenantId: chat.tenant_id,
        threadId,
        channel,
        minutes: 30,
      });

      const client = await getTenantChannelProviderClient(chat.tenant_id, channel);
      if (!client) throw ApiErrorFactory.internalServerError(new Error('Channel provider is not configured'));

      const suppliedKey = bodyValidation.data.idempotencyKey
        ?? ctx.request.headers.get('idempotency-key')
        ?? randomUUID();
      const digest = createHash('sha256')
        .update(`${chatId}\u0000${ctx.user?.id ?? ''}\u0000${suppliedKey}`)
        .digest('hex');
      const delivery = await sendOutboundOnce({
        tenantId: chat.tenant_id,
        threadId,
        idempotencyKey: `operator:${digest}`,
        channel,
        chatId,
        userId: ctx.user?.id ?? null,
        from: `operator:${ctx.user?.id ?? 'unknown'}`,
        to: chat.customer_phone,
        content: text,
        send: () => client.sendTextMessage(chat.customer_phone, text),
      });
      if (delivery.status === 'failed') {
        throw ApiErrorFactory.internalServerError(new Error(delivery.reason ?? 'Provider rejected message'));
      }

      try { chatMessagesSent.inc({ tenant: chat.tenant_id }); } catch { /* ignore metrics errors */ }
      span.addEvent('Operator message persisted and handed to channel provider');
      return { ok: true, id: delivery.messageId, deliveryStatus: delivery.status };
    } finally {
      span.end();
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
