import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getConversation, updateConversation } from './conversationState';
import type { ConvChannel } from './conversationState';

const HUMAN_HANDLING_UNTIL_KEY = 'human_handling_until';

export interface HumanTakeoverThread {
  id: string;
  status: 'active' | 'completed' | 'abandoned' | 'handed_off' | 'closed';
  humanHandlingUntil: string | null;
}

export interface HumanTakeoverStore {
  loadThread(input: { tenantId: string; threadId: string }): Promise<HumanTakeoverThread | null>;
  updateThread(input: {
    tenantId: string;
    threadId: string;
    status: HumanTakeoverThread['status'];
    humanHandlingUntil: string | null;
    fromStatuses: HumanTakeoverThread['status'][];
  }): Promise<void>;
  projectCompatibility(input: {
    tenantId: string;
    threadId: string;
    externalId: string;
    channel: ConvChannel;
    humanHandlingUntil: string | null;
  }): Promise<void>;
}

function defaultStore(): HumanTakeoverStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadThread(input) {
      const { data, error } = await admin.from('conversation_threads')
        .select('id, status, human_handling_until')
        .eq('tenant_id', input.tenantId)
        .eq('id', input.threadId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: String(data.id),
        status: data.status as HumanTakeoverThread['status'],
        humanHandlingUntil: typeof data.human_handling_until === 'string'
          ? data.human_handling_until
          : null,
      };
    },

    async updateThread(input) {
      const now = new Date().toISOString();
      const { data, error } = await admin.from('conversation_threads').update({
        status: input.status,
        human_handling_until: input.humanHandlingUntil,
        updated_at: now,
        ...(input.status === 'closed' ? { completed_at: now } : {}),
      }).eq('tenant_id', input.tenantId)
        .eq('id', input.threadId)
        .in('status', input.fromStatuses)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Conversation thread was not found in the tenant');
    },

    async projectCompatibility(input) {
      const conversation = await getConversation(input.externalId, input.tenantId, input.channel);
      if (!conversation || conversation.active_thread_id !== input.threadId) return;
      const flowData = { ...(conversation.flow_data ?? {}) };
      if (input.humanHandlingUntil) {
        flowData[HUMAN_HANDLING_UNTIL_KEY] = input.humanHandlingUntil;
      } else {
        delete flowData[HUMAN_HANDLING_UNTIL_KEY];
      }
      await updateConversation(
        input.externalId,
        input.tenantId,
        { flow_data: flowData },
        input.channel,
      );
    },
  };
}

/** Compatibility-only reader for the expand phase. New decisions use the thread. */
export function isHumanHandling(
  flowData: Record<string, unknown> | null | undefined,
  now: number = Date.now(),
): boolean {
  const until = flowData?.[HUMAN_HANDLING_UNTIL_KEY];
  return typeof until === 'string' && Date.parse(until) > now;
}

export async function isThreadHumanHandling(
  input: { tenantId: string; threadId: string },
  store: HumanTakeoverStore = defaultStore(),
  now: number = Date.now(),
): Promise<boolean> {
  const thread = await store.loadThread(input);
  return Boolean(thread?.humanHandlingUntil && Date.parse(thread.humanHandlingUntil) > now);
}

interface HumanHandlingTarget {
  externalId: string;
  tenantId: string;
  threadId: string;
  channel: ConvChannel;
}

export async function setHumanHandling(
  args: HumanHandlingTarget & { minutes: number },
  store: HumanTakeoverStore = defaultStore(),
): Promise<void> {
  const thread = await store.loadThread(args);
  if (!thread || thread.status === 'completed' || thread.status === 'closed') {
    throw new Error('Cannot hand off a missing or terminal conversation thread');
  }
  const until = new Date(Date.now() + args.minutes * 60_000).toISOString();
  await store.updateThread({
    tenantId: args.tenantId,
    threadId: args.threadId,
    status: 'handed_off',
    humanHandlingUntil: until,
    fromStatuses: ['active', 'handed_off'],
  });
  await store.projectCompatibility({ ...args, humanHandlingUntil: until });
}

export async function clearHumanHandling(
  args: HumanHandlingTarget & { close?: boolean },
  store: HumanTakeoverStore = defaultStore(),
): Promise<void> {
  const thread = await store.loadThread(args);
  if (!thread) throw new Error('Conversation thread was not found in the tenant');
  if (thread.status === 'completed' || thread.status === 'closed') return;
  await store.updateThread({
    tenantId: args.tenantId,
    threadId: args.threadId,
    status: args.close ? 'closed' : 'active',
    humanHandlingUntil: null,
    fromStatuses: ['active', 'handed_off'],
  });
  await store.projectCompatibility({ ...args, humanHandlingUntil: null });
}
