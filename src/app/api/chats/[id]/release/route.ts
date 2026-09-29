export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { clearHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';
import { z } from 'zod';

const ReleaseSchema = z.object({
  action: z.enum(['release', 'close']).default('release'),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const chatId = ctx.params?.id;
    if (!chatId) {
      throw ApiErrorFactory.validationError({ id: 'chat id required' });
    }

    const admin = createSupabaseAdminClient();
    const { data: chat, error } = await admin
      .from('chats')
      .select('tenant_id, customer_phone, metadata')
      .eq('id', chatId)
      .single();

    if (error || !chat) {
      throw ApiErrorFactory.notFound('Chat');
    }

    if (ctx.user?.tenantId && ctx.user.tenantId !== chat.tenant_id) {
      throw ApiErrorFactory.forbidden('Access denied');
    }

    if (!chat.customer_phone) {
      throw ApiErrorFactory.validationError({ chat: 'chat has no linked customer identity' });
    }

    let body: unknown = {};
    try { body = await ctx.request.json(); } catch { /* empty body means release */ }
    const parsed = ReleaseSchema.safeParse(body);
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    const channel = chat.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp';

    const { data: conversation, error: conversationError } = await admin
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

    await clearHumanHandling({
      externalId: chat.customer_phone,
      tenantId: chat.tenant_id,
      threadId: String(conversation.active_thread_id),
      channel,
      close: parsed.data.action === 'close',
    });

    return { success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
