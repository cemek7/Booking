import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/supabaseClient';
import { getSession } from '../../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../../lib/enhanced-rbac';
import { handleApiError } from '../../../../../lib/error-handling';
import { UserRole } from '../../../../../../types';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/chats/{id}/read
 * Marks all messages in a chat as read for the current user.
 * Requires 'staff' or higher role.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const chatId = params.id;
    if (!chatId) {
      return NextResponse.json({ error: 'Chat ID is required' }, { status: 400 });
    }

    const { session } = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerSupabaseClient();

    // 1. Fetch the chat to verify it exists and get its tenant_id
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, tenant_id')
      .eq('id', chatId)
      .single();

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    // 2. Authorize the user against the chat's tenant
    await validateTenantAccess(session.user.id, chat.tenant_id, [UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]);

    // 3. Perform the "mark as read" operations
    // These are best-effort operations, as the schema might be in flux.
    // A more robust solution would involve transactions if the operations were critical.
    
    // Reset unread_count on the chat itself
    const { error: updateChatError } = await supabase
      .from('chats')
      .update({ unread_count: 0, last_read_at: new Date().toISOString() })
      .eq('id', chatId)
      .eq('tenant_id', chat.tenant_id); // Ensure we only update the correct tenant's chat

    if (updateChatError) {
        console.warn(`Failed to update unread_count for chat ${chatId}:`, updateChatError.message);
        // Do not throw, as this is a non-critical part of the operation
    }

    // Mark all inbound messages in this chat as read
    const { error: updateMessagesError } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('chat_id', chatId)
      .eq('direction', 'inbound')
      .is('read_at', null);

    if (updateMessagesError) {
        console.warn(`Failed to update messages' read_at for chat ${chatId}:`, updateMessagesError.message);
        // Do not throw, as this is a non-critical part of the operation
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to mark chat as read');
  }
}
