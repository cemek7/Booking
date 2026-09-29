import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const MEMORY_FACT_KEYS = [
  'preferred_service', 'preferred_staff', 'preferred_time_window',
  'consented_contact_name', 'consented_email',
] as const;
export type MemoryFactKey = typeof MEMORY_FACT_KEYS[number];
export interface MemoryFactInput {
  tenantId: string; customerId: string; key: MemoryFactKey; value: unknown;
  sourceType: 'explicit_message' | 'operator'; sourceMessageId?: string;
  sourceRecordId?: string; consentBasis?: string; verifiedAt: string;
}
export interface MemoryFact extends MemoryFactInput { id: string }
export interface MemoryFactStore { recordAtomic(input: MemoryFactInput): Promise<MemoryFact> }

function defaultStore(): MemoryFactStore {
  const admin = createSupabaseAdminClient();
  return {
    async recordAtomic(input) {
      const { data, error } = await admin.rpc('record_verified_customer_memory_fact', {
        p_tenant_id: input.tenantId, p_customer_id: input.customerId, p_fact_key: input.key,
        p_fact_value: input.value, p_source_type: input.sourceType,
        p_source_message_id: input.sourceMessageId ?? null, p_source_record_id: input.sourceRecordId ?? null,
        p_consent_basis: input.consentBasis ?? null, p_verified_at: input.verifiedAt,
      });
      if (error) throw error;
      return { id: String(data), ...input };
    },
  };
}

export async function recordVerifiedMemoryFact(input: MemoryFactInput, store: MemoryFactStore = defaultStore()): Promise<MemoryFact> {
  if (!MEMORY_FACT_KEYS.includes(input.key)) throw new Error('Unsupported customer memory fact');
  if (input.sourceType === 'explicit_message' && !input.sourceMessageId) throw new Error('Explicit memory requires a source message');
  if (input.sourceType === 'operator' && !input.sourceRecordId) throw new Error('Operator memory requires a source record');
  if (!input.verifiedAt || Number.isNaN(Date.parse(input.verifiedAt))) throw new Error('Verified memory requires a valid timestamp');
  if (!['string', 'number', 'boolean'].includes(typeof input.value)) throw new Error('Customer memory value must be scalar');
  if (typeof input.value === 'string' && (input.value.length === 0 || input.value.length > 200)) {
    throw new Error('Customer memory value length is invalid');
  }
  return store.recordAtomic(input);
}

export function extractExplicitMemoryFacts(message: string): Array<{ key: MemoryFactKey; value: string }> {
  const normalized = message.trim();
  const preference = normalized.match(/^i\s+prefer\s+(.+?)(?:\s+with\s+([\p{L}][\p{L}\s'.-]{0,80}))?[.!]?$/iu);
  if (preference) {
    const preferred = preference[1].trim();
    if (/^(?:morning|mornings|afternoon|afternoons|evening|evenings|weekends?)$/i.test(preferred)) {
      return [{ key: 'preferred_time_window', value: preferred }];
    }
    const facts: Array<{ key: MemoryFactKey; value: string }> = [
      { key: 'preferred_service', value: preference[1].trim() },
    ];
    if (preference[2]) facts.push({ key: 'preferred_staff', value: preference[2].trim() });
    return facts;
  }
  const callMe = normalized.match(/^call\s+me\s+([\p{L}][\p{L}\s'.-]{0,80})[.!]?$/iu);
  if (callMe) return [{ key: 'consented_contact_name', value: callMe[1].replace(/[.!]$/, '').trim() }];
  const email = normalized.match(/^my\s+email\s+is\s+([^\s@]+@[^\s@]+\.[^\s@]+)[.!]?$/i);
  if (email) return [{ key: 'consented_email', value: email[1].replace(/[.!]$/, '').toLowerCase() }];
  return [];
}
