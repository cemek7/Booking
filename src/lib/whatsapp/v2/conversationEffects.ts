import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { conversationDuplicateEffectPrevented, safeMetric } from './continuityMetrics';

export type ConversationEffectStatus = 'started' | 'succeeded' | 'failed' | 'delivery_unknown';

export interface ConversationEffectRow {
  tenantId: string;
  threadId: string;
  idempotencyKey: string;
  effectType: string;
  status: ConversationEffectStatus;
  resultRef: string | null;
  metadata: Record<string, unknown>;
}

interface EffectIdentity {
  tenantId: string;
  threadId: string;
  idempotencyKey: string;
  effectType: string;
}

export interface ConversationEffectStore {
  reserve(input: EffectIdentity): Promise<{ claimed: boolean; row: ConversationEffectRow }>;
  restartFailed(input: EffectIdentity): Promise<boolean>;
  succeed(input: EffectIdentity & {
    resultRef: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  fail(input: EffectIdentity & { metadata: Record<string, unknown> }): Promise<void>;
  markUnknown(input: EffectIdentity & { metadata: Record<string, unknown> }): Promise<void>;
}

export class ConversationEffectBlockedError extends Error {
  constructor(public readonly status: 'started' | 'delivery_unknown') {
    super(`Conversation effect cannot be repeated while status is ${status}`);
    this.name = 'ConversationEffectBlockedError';
  }
}

function mapRow(row: Record<string, unknown>): ConversationEffectRow {
  return {
    tenantId: String(row.tenant_id ?? ''),
    threadId: String(row.thread_id ?? ''),
    idempotencyKey: String(row.idempotency_key ?? ''),
    effectType: String(row.effect_type ?? ''),
    status: row.status as ConversationEffectStatus,
    resultRef: typeof row.result_ref === 'string' ? row.result_ref : null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}

function defaultStore(): ConversationEffectStore {
  const admin = createSupabaseAdminClient();
  const find = async (input: EffectIdentity): Promise<ConversationEffectRow> => {
    const { data, error } = await admin.from('conversation_effects').select('*')
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .single();
    if (error || !data) throw error ?? new Error('Conversation effect disappeared after reservation');
    return mapRow(data as Record<string, unknown>);
  };

  return {
    async reserve(input) {
      const { data, error } = await admin.from('conversation_effects').insert({
        tenant_id: input.tenantId,
        thread_id: input.threadId,
        idempotency_key: input.idempotencyKey,
        effect_type: input.effectType,
        status: 'started',
      }).select('*').single();
      if (!error && data) return { claimed: true, row: mapRow(data as Record<string, unknown>) };
      if (error?.code !== '23505') throw error ?? new Error('Unable to reserve conversation effect');
      return { claimed: false, row: await find(input) };
    },

    async restartFailed(input) {
      const { data, error } = await admin.from('conversation_effects').update({
        status: 'started',
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', input.tenantId)
        .eq('idempotency_key', input.idempotencyKey)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async succeed(input) {
      const { error } = await admin.from('conversation_effects').update({
        status: 'succeeded',
        result_ref: input.resultRef,
        metadata: input.metadata,
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', input.tenantId)
        .eq('idempotency_key', input.idempotencyKey)
        .eq('status', 'started');
      if (error) throw error;
    },

    async fail(input) {
      const { error } = await admin.from('conversation_effects').update({
        status: 'failed',
        metadata: input.metadata,
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', input.tenantId)
        .eq('idempotency_key', input.idempotencyKey)
        .eq('status', 'started');
      if (error) throw error;
    },

    async markUnknown(input) {
      const { error } = await admin.from('conversation_effects').update({
        status: 'delivery_unknown',
        metadata: input.metadata,
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', input.tenantId)
        .eq('idempotency_key', input.idempotencyKey)
        .eq('status', 'started');
      if (error) throw error;
    },
  };
}

export async function runIdempotentEffect<T>(input: EffectIdentity & {
  execute: () => Promise<T>;
  resultRef?: (value: T) => string | null;
  store?: ConversationEffectStore;
}): Promise<T> {
  const store = input.store ?? defaultStore();
  const reservation = await store.reserve(input);

  if (!reservation.claimed) {
    if (
      reservation.row.threadId !== input.threadId
      || reservation.row.effectType !== input.effectType
    ) {
      throw new Error('Conversation effect idempotency collision');
    }
    if (reservation.row.status === 'succeeded') {
      safeMetric(() => conversationDuplicateEffectPrevented.inc({
        effect_type: input.effectType,
        status: 'succeeded',
      }));
      if (!Object.prototype.hasOwnProperty.call(reservation.row.metadata, 'result')) {
        throw new Error('Succeeded conversation effect has no replayable result');
      }
      return reservation.row.metadata.result as T;
    }
    if (reservation.row.status === 'started' || reservation.row.status === 'delivery_unknown') {
      safeMetric(() => conversationDuplicateEffectPrevented.inc({
        effect_type: input.effectType,
        status: reservation.row.status,
      }));
      throw new ConversationEffectBlockedError(reservation.row.status);
    }
    if (!await store.restartFailed(input)) {
      throw new ConversationEffectBlockedError('started');
    }
  }

  let value: T;
  try {
    value = await input.execute();
  } catch (error) {
    await store.fail({
      ...input,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }

  try {
    await store.succeed({
      ...input,
      resultRef: input.resultRef?.(value) ?? null,
      metadata: { result: value as unknown },
    });
  } catch (error) {
    // The external effect has already succeeded. If recording that success is
    // ambiguous, retrying could duplicate a booking or payment. Even if this
    // status update also fails, the existing `started` row remains fail-closed.
    await store.markUnknown({
      ...input,
      metadata: { persistence_error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    throw new ConversationEffectBlockedError('delivery_unknown');
  }
  return value;
}
