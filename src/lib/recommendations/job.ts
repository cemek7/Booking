import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { runGenerators } from './registry';
import {
  listRecommendations,
  observeOutcomes,
  sendHighValueRecommendationNudge,
  type RecommendationRecord,
} from './outcomes';

export async function runRecommendationCycle(
  admin: SupabaseClient,
  now = new Date(),
) {
  const { data: tenants, error } = await admin.from('tenants').select('id');
  if (error) throw error;

  const summary = [];
  for (const tenant of tenants ?? []) {
    const tenantId = String((tenant as { id?: string }).id ?? '');
    if (!tenantId) continue;
    const generatedDrafts = await runGenerators(admin, tenantId);
    const generated = await listRecommendations(admin, tenantId, { status: 'pending', includeSnoozed: true });
    const outcomes = await observeOutcomes(admin, tenantId, now);
    const nudges = await sendHighValueRecommendationNudge(
      admin,
      tenantId,
      generated as RecommendationRecord[],
      now,
    );
    summary.push({
      tenant_id: tenantId,
      generated: generatedDrafts.length,
      outcomes,
      nudges,
    });
  }

  return { tenants: summary };
}

export async function runRecommendationCycleWithAdmin(now = new Date()) {
  return runRecommendationCycle(createSupabaseAdminClient(), now);
}
