import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { ConvChannel } from './conversationState';
import { conversationStateConflict, safeMetric } from './continuityMetrics';
import {
  emptyConversationStructuredState,
  parseConversationStructuredState,
  type ConversationStructuredState,
} from './structuredState';

export type ThreadStatus = 'active' | 'completed' | 'abandoned' | 'handed_off' | 'closed';

export type ConversationThread = {
  id: string;
  tenantId: string;
  customerId: string;
  channelIdentityId: string;
  channel: ConvChannel;
  status: ThreadStatus;
  structuredState: ConversationStructuredState;
  stateVersion: number;
  updatedAt: string;
};

type EnsureThreadInput = {
  tenantId: string;
  customerId: string;
  channelIdentityId: string;
  channel: ConvChannel;
  conversationId: string;
};

type UpdateThreadStateInput = {
  tenantId: string;
  threadId: string;
  expectedVersion: number;
  state: ConversationStructuredState;
  projectCompatibility?: boolean;
};

type TransitionThreadInput = {
  tenantId: string;
  threadId: string;
  from: ThreadStatus[];
  to: ThreadStatus;
};

export function isConversationStateConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error ? String(error.message ?? '') : '';
  return message.includes('conversation_state_version_conflict')
    || message.includes('conversation_state_conflict');
}

export interface ConversationThreadStore {
  findUnfinishedThread(input: Pick<EnsureThreadInput, 'tenantId' | 'channelIdentityId'>): Promise<ConversationThread | null>;
  createThread(input: Omit<EnsureThreadInput, 'conversationId'>): Promise<ConversationThread>;
  attachConversation(input: {
    tenantId: string; conversationId: string; threadId: string; stateVersion: number;
  }): Promise<void>;
  updateCanonicalState(input: UpdateThreadStateInput): Promise<number>;
  projectCompatibilityState(input: {
    tenantId: string; threadId: string; stateVersion: number; state: ConversationStructuredState;
  }): Promise<void>;
  transition(input: TransitionThreadInput): Promise<void>;
}

function mapThread(row: Record<string, unknown>): ConversationThread {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    channelIdentityId: String(row.channel_identity_id),
    channel: row.channel as ConvChannel,
    status: row.status as ThreadStatus,
    structuredState: parseConversationStructuredState(row.structured_state),
    stateVersion: Number(row.state_version ?? 0),
    updatedAt: String(row.updated_at),
  };
}

const THREAD_SELECT = 'id, tenant_id, customer_id, channel_identity_id, channel, status, structured_state, state_version, updated_at';

function createConversationThreadStore(): ConversationThreadStore {
  const admin = createSupabaseAdminClient();
  return {
    async findUnfinishedThread(input) {
      const { data, error } = await admin.from('conversation_threads')
        .select(THREAD_SELECT)
        .eq('tenant_id', input.tenantId)
        .eq('channel_identity_id', input.channelIdentityId)
        .in('status', ['active', 'handed_off'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapThread(data) : null;
    },

    async createThread(input) {
      const { data, error } = await admin.from('conversation_threads').insert({
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        channel_identity_id: input.channelIdentityId,
        channel: input.channel,
        status: 'active',
        structured_state: emptyConversationStructuredState(),
      }).select(THREAD_SELECT).single();
      if (error) throw error;
      return mapThread(data);
    },

    async attachConversation(input) {
      const { error } = await admin.from('whatsapp_conversations').update({
        active_thread_id: input.threadId,
        state_version: input.stateVersion,
      }).eq('id', input.conversationId).eq('tenant_id', input.tenantId);
      if (error) throw error;
    },

    async updateCanonicalState(input) {
      const { data, error } = await admin.rpc('update_conversation_thread_state', {
        p_tenant_id: input.tenantId,
        p_thread_id: input.threadId,
        p_expected_version: input.expectedVersion,
        p_structured_state: input.state,
      });
      if (error) throw error;
      const nextVersion = Number(data);
      if (!Number.isSafeInteger(nextVersion) || nextVersion < 0) {
        throw new Error('Invalid conversation state version returned by database');
      }
      return nextVersion;
    },

    async projectCompatibilityState(input) {
      const { data: conversation, error: readError } = await admin
        .from('whatsapp_conversations')
        .select('id, flow_data')
        .eq('tenant_id', input.tenantId)
        .eq('active_thread_id', input.threadId)
        .maybeSingle();
      if (readError || !conversation) {
        defaultLogger.warn('[conversationThread] compatibility projection skipped', {
          reason: readError ? 'read_failed' : 'conversation_missing',
        });
        return;
      }

      const current = conversation.flow_data && typeof conversation.flow_data === 'object'
        && !Array.isArray(conversation.flow_data) ? conversation.flow_data : {};
      // Expand-phase projection only: pending messages are deliberately omitted.
      // Queue rows are canonical and Task 6 removes the legacy batching path.
      const safeCurrent = { ...(current as Record<string, unknown>) };
      delete safeCurrent.pending_messages;
      const { error } = await admin.from('whatsapp_conversations').update({
        flow_data: { ...safeCurrent, structured_state: input.state },
        state_version: input.stateVersion,
      }).eq('id', conversation.id).eq('tenant_id', input.tenantId).eq('active_thread_id', input.threadId);
      if (error) {
        defaultLogger.warn('[conversationThread] compatibility projection failed');
      }
    },

    async transition(input) {
      const now = new Date().toISOString();
      const terminal = input.to === 'completed' || input.to === 'closed';
      const { data, error } = await admin.from('conversation_threads').update({
        status: input.to,
        updated_at: now,
        ...(terminal ? { completed_at: now } : {}),
      }).eq('tenant_id', input.tenantId).eq('id', input.threadId)
        .in('status', input.from).select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('conversation_thread_transition_conflict');
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

export async function ensureActiveThread(
  input: EnsureThreadInput,
  store: ConversationThreadStore = createConversationThreadStore(),
): Promise<ConversationThread> {
  let thread = await store.findUnfinishedThread(input);
  if (!thread) {
    try {
      thread = await store.createThread({
        tenantId: input.tenantId,
        customerId: input.customerId,
        channelIdentityId: input.channelIdentityId,
        channel: input.channel,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      thread = await store.findUnfinishedThread(input);
      if (!thread) throw error;
    }
  }

  await store.attachConversation({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    threadId: thread.id,
    stateVersion: thread.stateVersion,
  });
  return thread;
}

export async function updateThreadState(
  input: UpdateThreadStateInput,
  store: ConversationThreadStore = createConversationThreadStore(),
): Promise<{ stateVersion: number }> {
  let stateVersion: number;
  try {
    stateVersion = await store.updateCanonicalState(input);
  } catch (error) {
    if (isConversationStateConflict(error)) {
      safeMetric(() => conversationStateConflict.inc({ operation: 'structured_state' }));
    }
    throw error;
  }
  if (input.projectCompatibility !== false) {
    await store.projectCompatibilityState({
      tenantId: input.tenantId,
      threadId: input.threadId,
      state: input.state,
      stateVersion,
    });
  }
  return { stateVersion };
}

export async function transitionThread(
  input: TransitionThreadInput,
  store: ConversationThreadStore = createConversationThreadStore(),
): Promise<void> {
  if (input.from.length === 0) throw new Error('At least one source thread status is required');
  await store.transition(input);
}
