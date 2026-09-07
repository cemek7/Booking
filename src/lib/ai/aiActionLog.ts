import type { SupabaseClient } from '@supabase/supabase-js';

export interface AiActionLogEntry {
  tenantId: string;
  actorType: string;
  actorId?: string | null;
  channel?: string | null;
  rawMessage?: string | null;
  action: string;
  params?: Record<string, unknown>;
  idempotencyKey: string;
  validationResult?: Record<string, unknown> | null;
  outcome: 'executed' | 'rejected' | 'needs_confirmation' | 'pending_approval' | 'duplicate' | 'denied';
  model?: string | null;
}

export async function findByIdempotencyKey(
  admin: SupabaseClient,
  tenantId: string,
  idempotencyKey: string
): Promise<{ outcome: string } | null> {
  const { data, error } = await admin
    .from('ai_action_log')
    .select('outcome')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function logAiAction(admin: SupabaseClient, entry: AiActionLogEntry): Promise<void> {
  const { error } = await admin.from('ai_action_log').insert({
    tenant_id: entry.tenantId,
    actor_type: entry.actorType,
    actor_id: entry.actorId ?? null,
    channel: entry.channel ?? null,
    raw_message: entry.rawMessage ?? null,
    action: entry.action,
    params: entry.params ?? {},
    idempotency_key: entry.idempotencyKey,
    validation_result: entry.validationResult ?? null,
    outcome: entry.outcome,
    model: entry.model ?? null,
  });

  if (error) throw error;
}
