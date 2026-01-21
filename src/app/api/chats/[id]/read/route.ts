import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { NextResponse } from 'next/server';

/**
 * POST /api/chats/{id}/read
 * Marks all messages in a chat as read for the current user.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const chatId = ctx.params?.id;
    if (!chatId) {
      throw ApiErrorFactory.validationError({ id: 'Chat ID is required' });
    }

    // Fetch the chat to verify it exists and get its tenant_id
    const { data: chat, error: chatError } = await ctx.supabase
      .from('chats')
      .select('id, tenant_id')
      .eq('id', chatId)
      .single();

    if (chatError || !chat) {
      throw ApiErrorFactory.notFound('Chat');
    }

    // Verify user has access to this tenant's chat
    if (ctx.user?.tenantId && ctx.user.tenantId !== chat.tenant_id) {
      throw ApiErrorFactory.forbidden('Access denied to this chat');
    }

    // Reset unread_count on the chat itself (best-effort)
    const { error: updateChatError } = await ctx.supabase
      .from('chats')
      .update({ unread_count: 0, last_read_at: new Date().toISOString() })
      .eq('id', chatId)
      .eq('tenant_id', chat.tenant_id);

    if (updateChatError) {
      console.warn(`Failed to update unread_count for chat ${chatId}:`, updateChatError.message);
    }

    // Mark all inbound messages in this chat as read (best-effort)
    const { error: updateMessagesError } = await ctx.supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('chat_id', chatId)
      .eq('direction', 'inbound')
      .is('read_at', null);

    if (updateMessagesError) {
      console.warn(`Failed to update messages' read_at for chat ${chatId}:`, updateMessagesError.message);
    }

    // Return 204 No Content
    return new NextResponse(null, { status: 204 });
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
