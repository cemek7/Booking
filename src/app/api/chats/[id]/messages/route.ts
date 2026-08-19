export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { chatMessagesSent } from '@/lib/metrics';
import { trace } from '@opentelemetry/api';
import { defaultLogger } from '@/lib/logger';
import { getTenantChannelProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { setHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';
import { computeOutboundReadiness } from '@/lib/chats/outboundReadiness';

const PostMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'Message text cannot be empty'),
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

      // Insert the outbound message
      const { data: newMessage, error: insertError } = await ctx.supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          tenant_id: chat.tenant_id,
          user_id: ctx.user?.id,
          content: text,
          direction: 'outbound',
          to_number: chat.customer_phone,
        })
        .select('id, created_at')
        .single();

      if (insertError) {
        span.recordException(insertError);
        throw ApiErrorFactory.databaseError(insertError);
      }

      try { chatMessagesSent.inc({ tenant: chat.tenant_id }); } catch { /* ignore metrics errors */ }
      span.addEvent('Message inserted into DB');

      if (chat.customer_phone) {
        await setHumanHandling({
          externalId: chat.customer_phone,
          tenantId: chat.tenant_id,
          channel,
          minutes: 30,
        }).catch((e) => defaultLogger.warn('setHumanHandling failed', { error: String(e) }));
      }

      // Fire-and-forget handoff to external messaging provider
      (async () => {
        try {
          const client = await getTenantChannelProviderClient(chat.tenant_id, channel);
          const number = chat.customer_phone;

          if (client && number) {
            await client.sendTextMessage(number, text);
            span.addEvent('Handoff to channel provider successful');
          } else {
            span.addEvent('Handoff to channel provider skipped: missing config');
          }
        } catch (e) {
          span.recordException(e as Error);
          defaultLogger.error('Channel provider handoff failed:', e);
        }
      })();

      return { ok: true, id: newMessage.id, createdAt: newMessage.created_at };
    } finally {
      span.end();
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
