import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { buildDefaultWhatsAppProviderConfig, getProviderClient } from '@/lib/whatsapp/providers';
import type { DetectedAnomaly } from './rules/registry';

const DEFAULT_DEBOUNCE_MINUTES = 15;

type AnomalySummary = {
  openCount: number;
  totalAtRiskCents: number;
  highSeverityCount: number;
  criticalSeverityCount: number;
};

function formatMoney(cents: number) {
  return `₦${Math.round(cents / 100).toLocaleString()}`;
}

async function findOwnerPhone(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('tenant_users')
    .select('users!inner(phone)')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .maybeSingle();

  if (error) {
    defaultLogger.warn('[anomaly.notify] owner phone lookup failed', {
      tenantId,
      error: error.message,
    });
    return null;
  }

  return (data?.users as { phone?: string | null } | null)?.phone ?? null;
}

function atRiskCents(detection: DetectedAnomaly): number {
  if (typeof detection.differenceCents === 'number') {
    return Math.abs(detection.differenceCents);
  }
  if (typeof detection.expectedValueCents === 'number') {
    return Math.abs(detection.expectedValueCents);
  }
  if (typeof detection.actualValueCents === 'number') {
    return Math.abs(detection.actualValueCents);
  }
  return 0;
}

export async function getAnomalySummary(
  admin: SupabaseClient,
  tenantId: string
): Promise<AnomalySummary> {
  const { data, error } = await admin
    .from('business_anomalies')
    .select('severity, difference_cents, expected_value_cents, actual_value_cents')
    .eq('tenant_id', tenantId)
    .in('status', ['open', 'investigating']);

  if (error) throw error;

  const rows =
    (data as Array<{
      severity?: string | null;
      difference_cents?: number | null;
      expected_value_cents?: number | null;
      actual_value_cents?: number | null;
    }>) ?? [];

  return rows.reduce<AnomalySummary>(
    (summary, row) => {
      summary.openCount += 1;
      summary.totalAtRiskCents += Math.abs(
        Number(
          row.difference_cents ??
            row.expected_value_cents ??
            row.actual_value_cents ??
            0
        )
      );
      if (row.severity === 'high') summary.highSeverityCount += 1;
      if (row.severity === 'critical') summary.criticalSeverityCount += 1;
      return summary;
    },
    { openCount: 0, totalAtRiskCents: 0, highSeverityCount: 0, criticalSeverityCount: 0 }
  );
}

export function formatAnomalyDigestSummary(summary: AnomalySummary): string | null {
  if (summary.openCount <= 0) return null;
  return `${summary.openCount} open anomalies, ${formatMoney(summary.totalAtRiskCents)} at risk`;
}

async function hasRecentAlert(
  admin: SupabaseClient,
  tenantId: string,
  sinceIso: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('business_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('action', BUSINESS_EVENT_ACTIONS.ANOMALY_ALERTED)
    .gte('created_at', sinceIso)
    .limit(1)
    .maybeSingle();

  if (error) {
    defaultLogger.warn('[anomaly.notify] alert debounce lookup failed', {
      tenantId,
      error: error.message,
    });
    return false;
  }

  return Boolean(data?.id);
}

export async function notifyRealtimeAnomalies(
  admin: SupabaseClient,
  tenantId: string,
  detections: DetectedAnomaly[]
): Promise<void> {
  const urgent = detections.filter(
    (detection) => detection.severity === 'high' || detection.severity === 'critical'
  );
  if (urgent.length === 0) return;

  const debounceMinutes = Number(process.env.BOOKA_ANOMALY_ALERT_DEBOUNCE_MINUTES ?? DEFAULT_DEBOUNCE_MINUTES);
  const sinceIso = new Date(Date.now() - debounceMinutes * 60 * 1000).toISOString();
  if (await hasRecentAlert(admin, tenantId, sinceIso)) return;

  const ownerPhone = await findOwnerPhone(admin, tenantId);
  if (!ownerPhone) return;

  const config = buildDefaultWhatsAppProviderConfig();
  if (!config) return;

  const first = urgent[0];
  const client = getProviderClient(config);
  const message = [
    'Booka alert',
    '',
    `${urgent.length} high-priority anomaly${urgent.length === 1 ? '' : 'ies'} detected.`,
    `Top issue: ${first.ruleKey.replaceAll('_', ' ')}`,
    `Value at risk: ${formatMoney(atRiskCents(first))}`,
    'Open the owner anomalies dashboard to review and resolve it.',
  ].join('\n');

  await client.sendTextMessage(ownerPhone, message);

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'system',
    action: BUSINESS_EVENT_ACTIONS.ANOMALY_ALERTED,
    entityType: 'business_anomaly',
    entityId: first.anomalyId,
    source: 'system',
    metadata: {
      alert_count: urgent.length,
      debounce_minutes: debounceMinutes,
      anomaly_ids: urgent.map((detection) => detection.anomalyId),
      sent_to: ownerPhone,
    },
  });
}
