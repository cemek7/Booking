import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { summarizeChat } from '@/lib/summarizerWorker';

export const POST = createHttpHandler(
  async (ctx) => {
    const { data: chats, error: chatsErr } = await ctx.supabase
      .from('chats')
      .select('id, tenant_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (chatsErr) {
      throw ApiErrorFactory.internal('Failed to query chats');
    }

    type ChatRow = {
      id: string;
      tenant_id?: string | null;
      metadata?: Record<string, unknown> | null;
    };

    const toSummarize = (chats || []).filter((c: ChatRow) => {
      const md = c.metadata || {};
      return !md || !md.summary;
    }) as ChatRow[];

    const results: Array<{ chatId: string; summary?: string; err?: string }> = [];
    for (const c of toSummarize) {
      try {
        const r = await summarizeChat(ctx.supabase, c.id, c.tenant_id ?? undefined);
        results.push({ chatId: c.id, summary: r.summary });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ chatId: c.id, err: msg });
      }
    }

    return { ok: true, results };
  },
  'POST',
  { auth: true, roles: ['global_admin'] }
);
