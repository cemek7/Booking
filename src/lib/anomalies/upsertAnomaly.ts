import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

export type AnomalyDomain = 'service' | 'retail' | 'inventory';
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';
export type AnomalyStatus = 'open' | 'investigating' | 'resolved' | 'dismissed' | 'false_positive';
export type AnomalyDetectionSource = 'reconciliation' | 'realtime_event';

export interface AnomalyCandidate {
  tenantId: string;
  ruleKey: string;
  domain: AnomalyDomain;
  severity: AnomalySeverity;
  entityType?: string | null;
  entityId?: string | null;
  expectedValueCents?: number | null;
  actualValueCents?: number | null;
  differenceCents?: number | null;
  detectionSource: AnomalyDetectionSource;
  dedupKey?: string;
  runId?: string | null;
  detail?: Record<string, unknown>;
}

type AnomalyRow = {
  id: string;
  status: AnomalyStatus;
  detail?: Record<string, unknown> | null;
};

export async function upsertAnomaly(
  admin: SupabaseClient,
  candidate: AnomalyCandidate & { dedupKey: string }
): Promise<string> {
  const nowIso = new Date().toISOString();

  const { data: existingActive, error: existingActiveError } = await admin
    .from('business_anomalies')
    .select('id, status')
    .eq('tenant_id', candidate.tenantId)
    .eq('dedup_key', candidate.dedupKey)
    .in('status', ['open', 'investigating'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<AnomalyRow>();

  if (existingActiveError) throw existingActiveError;

  if (existingActive?.id) {
    const { error: updateError } = await admin
      .from('business_anomalies')
      .update({
        severity: candidate.severity,
        expected_value_cents: candidate.expectedValueCents ?? null,
        actual_value_cents: candidate.actualValueCents ?? null,
        difference_cents: candidate.differenceCents ?? null,
        detection_source: candidate.detectionSource,
        detail: candidate.detail ?? {},
        run_id: candidate.runId ?? null,
        last_seen_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', existingActive.id)
      .eq('tenant_id', candidate.tenantId);

    if (updateError) throw updateError;
    return existingActive.id;
  }

  const { data: previousResolved, error: previousResolvedError } = await admin
    .from('business_anomalies')
    .select('id, detail')
    .eq('tenant_id', candidate.tenantId)
    .eq('dedup_key', candidate.dedupKey)
    .in('status', ['resolved', 'dismissed', 'false_positive'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<AnomalyRow>();

  if (previousResolvedError) throw previousResolvedError;

  const detail = {
    ...(candidate.detail ?? {}),
    ...(previousResolved?.id ? { previous_anomaly_id: previousResolved.id } : {}),
  };

  const { data: inserted, error: insertError } = await admin
    .from('business_anomalies')
    .insert({
      tenant_id: candidate.tenantId,
      rule_key: candidate.ruleKey,
      domain: candidate.domain,
      severity: candidate.severity,
      status: 'open',
      entity_type: candidate.entityType ?? null,
      entity_id: candidate.entityId ?? null,
      expected_value_cents: candidate.expectedValueCents ?? null,
      actual_value_cents: candidate.actualValueCents ?? null,
      difference_cents: candidate.differenceCents ?? null,
      detection_source: candidate.detectionSource,
      dedup_key: candidate.dedupKey,
      run_id: candidate.runId ?? null,
      detail,
      first_detected_at: nowIso,
      last_seen_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single<{ id: string }>();

  if (insertError || !inserted) {
    throw insertError ?? new Error('Failed to insert anomaly');
  }

  await recordBusinessEvent(admin, {
    tenantId: candidate.tenantId,
    actorType: 'system',
    action: BUSINESS_EVENT_ACTIONS.ANOMALY_DETECTED,
    entityType: 'business_anomaly',
    entityId: inserted.id,
    source: 'system',
    metadata: {
      rule_key: candidate.ruleKey,
      severity: candidate.severity,
      detection_source: candidate.detectionSource,
      dedup_key: candidate.dedupKey,
    },
  });

  return inserted.id;
}
