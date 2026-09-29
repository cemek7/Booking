import { createSupabaseAdminClient } from '@/lib/supabase/server';

const HUMAN_PATTERNS: RegExp[] = [
  /\bagent\b/,
  /\bhuman\b/,
  /\brepresentative\b/,
  /(speak|talk|chat)\s+(to|with)\s+(a\s+)?(person|someone|human|agent|staff|representative)/,
  /real\s+person/,
];

export function wantsHuman(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return HUMAN_PATTERNS.some((re) => re.test(t));
}

export interface HumanHandoffInput {
  tenantId: string;
  customerPhone: string;
  sessionId: string;
  threadId: string;
  reason?: string;
}

type CanonicalThreadRow = {
  id: string;
  status: string;
  state_version: number;
  structured_state: unknown;
  rolling_summary: string | null;
};

export interface HumanHandoffStore {
  loadCanonicalThread(tenantId: string, threadId: string): Promise<CanonicalThreadRow | null>;
  findOpen(input: HumanHandoffInput & { reason: string; since: string }): Promise<{ id: string; status?: string } | null>;
  insert(payload: Record<string, unknown>): Promise<{ id: string } | null>;
}

function defaultStore(): HumanHandoffStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadCanonicalThread(tenantId, threadId) {
      const { data, error } = await admin.from('conversation_threads')
        .select('id, status, state_version, structured_state, rolling_summary')
        .eq('tenant_id', tenantId)
        .eq('id', threadId)
        .maybeSingle();
      if (error) throw error;
      return data as CanonicalThreadRow | null;
    },
    async findOpen(input) {
      const { data, error } = await admin.from('escalation_queue')
        .select('id, status')
        .eq('tenant_id', input.tenantId)
        .eq('conversation_thread_id', input.threadId)
        .eq('reason', input.reason)
        .gte('created_at', input.since)
        .in('status', ['pending', 'claimed'])
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; status?: string } | null;
    },
    async insert(payload) {
      const { data, error } = await admin.from('escalation_queue')
        .insert(payload)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return data as { id: string } | null;
    },
  };
}

export async function createHumanHandoff(
  input: HumanHandoffInput,
  store: HumanHandoffStore = defaultStore(),
): Promise<{ id: string; status?: string } | null> {
  const reason = (input.reason ?? 'customer requested human').trim() || 'customer requested human';
  const thread = await store.loadCanonicalThread(input.tenantId, input.threadId);
  if (!thread || thread.id !== input.threadId) {
    throw new Error('Canonical conversation thread was not found for handoff');
  }
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const existing = await store.findOpen({ ...input, reason, since });
  if (existing) return existing;

  return store.insert({
    tenant_id: input.tenantId,
    customer_phone: input.customerPhone,
    session_id: input.sessionId,
    conversation_thread_id: input.threadId,
    reason,
    status: 'pending',
    conversation_snapshot: {
      conversation_thread_id: input.threadId,
      status: thread.status,
      state_version: thread.state_version,
      structured_state: thread.structured_state,
      rolling_summary: thread.rolling_summary,
      captured_at: new Date().toISOString(),
    },
  });
}
