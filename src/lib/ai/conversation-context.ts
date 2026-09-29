import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { parseConversationStructuredState, type ConversationStructuredState } from '@/lib/whatsapp/v2/structuredState';

export interface MemoryFact {
  key: string;
  value: unknown;
  sourceType: string;
  verifiedAt: string | null;
}
export interface ConversationContext {
  threadId: string;
  structuredState: ConversationStructuredState;
  rollingSummary: string | null;
  recentTurns: Array<{ direction: 'inbound' | 'outbound'; content: string; at: string }>;
  verifiedFacts: MemoryFact[];
}
export interface ConversationContextStore {
  loadThread(input: { tenantId: string; threadId: string; customerId: string }): Promise<Record<string, unknown> | null>;
  loadTurns(input: { tenantId: string; threadId: string; limit: number }): Promise<Array<Record<string, unknown>>>;
  loadFacts(input: { tenantId: string; customerId: string; limit: number }): Promise<Array<Record<string, unknown>>>;
}

function defaultStore(): ConversationContextStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadThread(input) {
      const { data, error } = await admin.from('conversation_threads')
        .select('structured_state, rolling_summary')
        .eq('tenant_id', input.tenantId).eq('id', input.threadId).eq('customer_id', input.customerId).single();
      if (error) throw error;
      return data;
    },
    async loadTurns(input) {
      const { data, error } = await admin.from('messages')
        .select('direction, content, timestamp')
        .eq('tenant_id', input.tenantId).eq('conversation_thread_id', input.threadId)
        .in('direction', ['inbound', 'outbound'])
        .order('timestamp', { ascending: false }).limit(input.limit);
      if (error) throw error;
      return [...(data ?? [])].reverse();
    },
    async loadFacts(input) {
      const { data, error } = await admin.from('customer_memory_facts')
        .select('fact_key, fact_value, source_type, verified_at')
        .eq('tenant_id', input.tenantId).eq('customer_id', input.customerId)
        .eq('status', 'active').not('verified_at', 'is', null)
        .order('updated_at', { ascending: false }).limit(input.limit);
      if (error) throw error;
      return data ?? [];
    },
  };
}

export async function assembleConversationContext(
  input: { tenantId: string; threadId: string; customerId: string; recentTurnLimit?: number },
  store: ConversationContextStore = defaultStore(),
): Promise<ConversationContext> {
  const limit = Math.min(12, Math.max(1, input.recentTurnLimit ?? 12));
  const [thread, turns, facts] = await Promise.all([
    store.loadThread(input),
    store.loadTurns({ tenantId: input.tenantId, threadId: input.threadId, limit }),
    store.loadFacts({ tenantId: input.tenantId, customerId: input.customerId, limit: 20 }),
  ]);
  if (!thread) throw new Error('Conversation thread not found for tenant/customer');
  return {
    threadId: input.threadId,
    structuredState: parseConversationStructuredState(thread.structured_state),
    rollingSummary: typeof thread.rolling_summary === 'string' ? thread.rolling_summary : null,
    recentTurns: turns.map((row) => ({
      direction: row.direction === 'outbound' ? 'outbound' : 'inbound',
      content: String(row.content ?? '').slice(0, 2000),
      at: String(row.timestamp ?? ''),
    })),
    verifiedFacts: facts.map((row) => ({
      key: String(row.fact_key), value: row.fact_value, sourceType: String(row.source_type),
      verifiedAt: typeof row.verified_at === 'string' ? row.verified_at : null,
    })),
  };
}
