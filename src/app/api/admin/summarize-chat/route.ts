export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { summarizeChat } from '@/lib/summarizerWorker';

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json().catch(() => ({}));
    const { chat_id: chatId } = body;
    const tenantId = ctx.user!.tenantId;

    if (!chatId) {
      throw ApiErrorFactory.badRequest('chat_id required');
    }

    const result = await summarizeChat(ctx.supabase, chatId, tenantId);
    return { success: true, result };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);
