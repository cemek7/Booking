export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { clearHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';

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

    await clearHumanHandling({
      externalId: chat.customer_phone,
      tenantId: chat.tenant_id,
      channel: chat.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp',
    });

    return { success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
