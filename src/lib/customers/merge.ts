import type { SupabaseClient } from '@supabase/supabase-js';

import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recomputeProfile } from './profile';

type CustomerRow = {
  id: string;
  tenant_id: string;
  name?: string | null;
  customer_name?: string | null;
  email?: string | null;
  normalized_phone?: string | null;
  merged_into?: string | null;
};

export interface MergeCandidate {
  customerA: string;
  customerB: string;
  score: number;
  reason: 'normalized_phone' | 'email';
}

export async function detectDuplicates(
  admin: SupabaseClient,
  tenantId: string,
): Promise<MergeCandidate[]> {
  const { data, error } = await admin
    .from('customers')
    .select('id, tenant_id, name, customer_name, email, normalized_phone, merged_into')
    .eq('tenant_id', tenantId)
    .is('merged_into', null);

  if (error) throw error;

  const rows = (data ?? []) as CustomerRow[];
  const candidates: MergeCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (a: string, b: string, score: number, reason: MergeCandidate['reason']) => {
    const pair = [a, b].sort().join(':');
    if (seen.has(pair)) return;
    seen.add(pair);
    candidates.push({ customerA: a, customerB: b, score, reason });
  };

  const byPhone = new Map<string, CustomerRow[]>();
  const byEmail = new Map<string, CustomerRow[]>();

  for (const row of rows) {
    if (row.normalized_phone) {
      const group = byPhone.get(row.normalized_phone) ?? [];
      group.push(row);
      byPhone.set(row.normalized_phone, group);
    }
    const normalizedEmail = row.email?.trim().toLowerCase();
    if (normalizedEmail) {
      const group = byEmail.get(normalizedEmail) ?? [];
      group.push(row);
      byEmail.set(normalizedEmail, group);
    }
  }

  for (const group of byPhone.values()) {
    if (group.length < 2) continue;
    for (let index = 1; index < group.length; index += 1) {
      pushCandidate(group[0].id, group[index].id, 1, 'normalized_phone');
    }
  }

  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    for (let index = 1; index < group.length; index += 1) {
      pushCandidate(group[0].id, group[index].id, 0.8, 'email');
    }
  }

  if (candidates.length > 0) {
    await admin.from('customer_merge_candidates').upsert(
      candidates.map((candidate) => ({
        tenant_id: tenantId,
        customer_a: candidate.customerA,
        customer_b: candidate.customerB,
        score: candidate.score,
        status: 'pending',
        metadata: { reason: candidate.reason },
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'tenant_id,customer_a,customer_b' },
    );
  }

  return candidates;
}

export async function mergeCustomers(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    survivorId: string;
    loserId: string;
    actorId: string;
  },
): Promise<{ survivorId: string; loserId: string }> {
  const { data: beforeRows, error: beforeError } = await admin
    .from('customers')
    .select('id, name, customer_name, email, normalized_phone, merged_into')
    .eq('tenant_id', input.tenantId)
    .in('id', [input.survivorId, input.loserId]);

  if (beforeError) throw beforeError;

  const before = beforeRows ?? [];

  const { data, error } = await admin.rpc('merge_customers_tx', {
    p_tenant_id: input.tenantId,
    p_survivor_id: input.survivorId,
    p_loser_id: input.loserId,
  });

  if (error) throw error;

  await recomputeProfile(admin, input.tenantId, input.survivorId);

  const { data: afterSurvivor } = await admin
    .from('customers')
    .select('id, name, customer_name, email, normalized_phone, merged_into')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.survivorId)
    .maybeSingle();

  await recordBusinessEvent(admin, {
    tenantId: input.tenantId,
    actorType: 'user',
    actorId: input.actorId,
    action: BUSINESS_EVENT_ACTIONS.CUSTOMER_MERGED,
    entityType: 'customer',
    entityId: input.survivorId,
    source: 'dashboard',
    before,
    after: afterSurvivor ?? null,
    metadata: {
      survivor_id: input.survivorId,
      loser_id: input.loserId,
    },
  });

  const row = Array.isArray(data) ? data[0] : data;
  return {
    survivorId: String((row as { survivor_id?: string } | null)?.survivor_id ?? input.survivorId),
    loserId: String((row as { loser_id?: string } | null)?.loser_id ?? input.loserId),
  };
}
