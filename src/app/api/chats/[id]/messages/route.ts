export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { chatMessagesSent } from '@/lib/metrics';
import { trace } from '@opentelemetry/api';
import { defaultLogger } from '@/lib/logger';
import { getTenantChannelProviderClient } from '@/lib/whatsapp/providers/providerSelection';

const PostMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'Message text cannot be empty'),
});

function instagramReplyWindowMs(): number {
  const hours = Number(process.env.META_SERVICE_WINDOW_HOURS ?? 24);
  return (Number.isFinite(hours) ? hours : 24) * 60 * 60 * 1000;
}

function isInstagramReplyWindowOpen(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false;
  const timestamp = Date.parse(lastInboundAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < instagramReplyWindowMs();
}

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

      if (channel === 'instagram') {
        const { data: conv, error: convError } = await ctx.supabase
          .from('whatsapp_conversations')
          .select('last_inbound_at')
          .eq('tenant_id', chat.tenant_id)
          .eq('channel', 'instagram')
          .eq('external_id', chat.customer_phone)
          .maybeSingle();

        if (convError) {
          span.recordException(convError);
          throw ApiErrorFactory.databaseError(convError);
        }

        if (!isInstagramReplyWindowOpen(typeof conv?.last_inbound_at === 'string' ? conv.last_inbound_at : null)) {
          throw ApiErrorFactory.accountLocked(
            'Instagram replies are only allowed within 24 hours of the customer’s last message. Continue on WhatsApp for follow-up.'
          );
        }
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

      // Fire-and-forget handoff to external messaging provider
      (async () => {
        try {
          const client = await getTenantChannelProviderClient(chat.tenant_id, channel);
          const number = chat?.customer_phone;

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
