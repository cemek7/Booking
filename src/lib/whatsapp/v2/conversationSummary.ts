import { createSupabaseAdminClient } from '@/lib/supabase/server';

type Turn = { direction: 'inbound' | 'outbound'; content: string; at: string };
export interface ConversationSummaryStore {
  loadThread(input: { tenantId: string; threadId: string }): Promise<{ updatedAt: string; summaryThrough: string | null; rollingSummary: string | null } | null>;
  loadNewTurns(input: { tenantId: string; threadId: string; after: string | null; limit: number }): Promise<Turn[]>;
  updateSummary(input: { tenantId: string; threadId: string; expectedUpdatedAt: string; summary: string; through: string }): Promise<boolean>;
}

function defaultStore(admin = createSupabaseAdminClient()): ConversationSummaryStore {
  return {
    async loadThread(input) {
      const { data, error } = await admin.from('conversation_threads')
        .select('updated_at, summary_through_message_at, rolling_summary')
        .eq('tenant_id', input.tenantId).eq('id', input.threadId).single();
      if (error) throw error;
      return data ? { updatedAt: data.updated_at, summaryThrough: data.summary_through_message_at, rollingSummary: data.rolling_summary } : null;
    },
    async loadNewTurns(input) {
      let query = admin.from('messages').select('direction, content, timestamp')
        .eq('tenant_id', input.tenantId).eq('conversation_thread_id', input.threadId)
        .order('timestamp', { ascending: true }).limit(input.limit);
      if (input.after) query = query.gt('timestamp', input.after);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        direction: row.direction === 'outbound' ? 'outbound' : 'inbound',
        content: String(row.content ?? ''),
        at: String(row.timestamp ?? ''),
      }));
    },
    async updateSummary(input) {
      const { data, error } = await admin.rpc('update_conversation_thread_summary', {
        p_tenant_id: input.tenantId, p_thread_id: input.threadId,
        p_expected_updated_at: input.expectedUpdatedAt, p_summary: input.summary,
        p_summary_through: input.through,
      });
      if (error) throw error;
      return Boolean(data);
    },
  };
}

export async function runConversationSummaryJob(
  input: { tenantId: string; threadId: string },
  store: ConversationSummaryStore = defaultStore(),
): Promise<{ success: boolean; skipped?: boolean }> {
  const thread = await store.loadThread(input);
  if (!thread) throw new Error('Conversation summary thread not found');
  const turns = await store.loadNewTurns({ ...input, after: thread.summaryThrough, limit: 50 });
  if (turns.length === 0) return { success: true, skipped: true };
  const additions = turns.map((turn) => `${turn.direction}: ${turn.content.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n').slice(-4000);
  // Retain the prior summary explicitly so unresolved requests, rejected
  // options, promises, and handoff reasons are not displaced by a busy turn.
  const prior = thread.rollingSummary?.slice(-4000) ?? '';
  const summary = [prior, additions].filter(Boolean).join('\n');
  const through = turns[turns.length - 1].at;
  const updated = await store.updateSummary({ ...input, expectedUpdatedAt: thread.updatedAt, summary, through });
  if (!updated) throw new Error('Conversation summary optimistic update conflict');
  return { success: true };
}

export async function maybeScheduleConversationSummary(input: {
  tenantId: string; threadId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin.from('messages').select('id', { count: 'exact', head: true })
    .eq('tenant_id', input.tenantId).eq('conversation_thread_id', input.threadId);
  if (error || (count ?? 0) < 16) return;
  const { data: pending } = await admin.from('jobs').select('id')
    .eq('tenant_id', input.tenantId).eq('type', 'summarize_conversation_thread')
    .in('status', ['pending', 'processing']).contains('payload', { thread_id: input.threadId }).limit(1);
  if (pending?.length) return;
  await admin.from('jobs').insert({
    tenant_id: input.tenantId, type: 'summarize_conversation_thread',
    payload: { tenant_id: input.tenantId, thread_id: input.threadId }, status: 'pending',
    scheduled_at: new Date().toISOString(), priority: 3,
  });
}
