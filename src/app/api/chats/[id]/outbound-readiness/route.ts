export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { computeOutboundReadiness } from '@/lib/chats/outboundReadiness';

export const GET = createHttpHandler(
  async (ctx) => {
    const chatId = ctx.params?.id;
    if (!chatId) {
      throw ApiErrorFactory.validationError({ id: 'Chat ID is required' });
    }

    const { data: chat, error } = await ctx.supabase
      .from('chats')
      .select('id, tenant_id, customer_phone, metadata')
      .eq('id', chatId)
      .single();

    if (error || !chat) {
      throw ApiErrorFactory.notFound('Chat');
    }

    if (ctx.user?.tenantId && ctx.user.tenantId !== chat.tenant_id) {
      throw ApiErrorFactory.forbidden('Access denied to this chat');
    }

    const channel = chat.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp';
    if (!chat.customer_phone) {
      throw ApiErrorFactory.validationError({ customer_phone: 'Chat recipient is missing' });
    }

    const readiness = await computeOutboundReadiness(ctx.supabase as never, {
      tenantId: chat.tenant_id,
      externalId: chat.customer_phone,
      channel,
    });

    return {
      chatId,
      channel,
      readiness,
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
