import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { chatMessagesSent } from '@/lib/metrics';
import { trace } from '@opentelemetry/api';

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
        .select('id, tenant_id, customer_phone')
        .eq('id', chatId)
        .single();

      if (chatError || !chat) {
        span.setAttribute('chat.found', false);
        throw ApiErrorFactory.notFound('Chat');
      }
      span.setAttribute('tenant.id', chat.tenant_id);

      // Verify user has access to this tenant's chat
      if (ctx.user?.tenantId && ctx.user.tenantId !== chat.tenant_id) {
        throw ApiErrorFactory.forbidden('Access denied to this chat');
      }
      span.setAttribute('auth.authorized', true);

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
          const { data: tenant } = await ctx.supabase
            .from('tenants')
            .select('whatsapp_api_provider, waba_api_key, whatsapp_number_id, whatsapp_number')
            .eq('id', chat.tenant_id)
            .single();

          const baseUrl = process.env.EVOLUTION_BASE_URL || 'https://api.evolution-api.com';
          const apiKey = tenant?.waba_api_key || process.env.EVOLUTION_API_KEY;
          const instance = tenant?.whatsapp_number_id;
          const number = chat?.customer_phone;

          if (apiKey && instance && number) {
            await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
              body: JSON.stringify({ number, textMessage: { text } }),
            });
            span.addEvent('Handoff to Evolution API successful');
          } else {
            span.addEvent('Handoff to Evolution API skipped: missing config');
          }
        } catch (e) {
          span.recordException(e as Error);
          console.error('Evolution API handoff failed:', e);
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
