import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { notifyRealtimeAnomalies } from './notify';
import { getMatchingRules, type DetectedAnomaly, type RuleWindow } from './rules/registry';
import { upsertAnomaly } from './upsertAnomaly';

export interface BusinessEventRecord {
  tenantId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt?: string | null;
}

function eventWindow(event: BusinessEventRecord): RuleWindow {
  const end = event.createdAt ? new Date(event.createdAt) : new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  return {
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  };
}

export async function processBusinessEventForAnomalies(
  admin: SupabaseClient,
  event: BusinessEventRecord
): Promise<DetectedAnomaly[]> {
  if (!event.tenantId || !event.action) return [];

  const ctx = {
    window: eventWindow(event),
    eventAction: event.action,
    runId: null,
  };
  const rules = getMatchingRules('realtime', ctx);
  if (rules.length === 0) return [];

  const detections: DetectedAnomaly[] = [];
  for (const rule of rules) {
    const candidates = await rule.detect(admin, event.tenantId, ctx.window, ctx);
    for (const candidate of candidates) {
      const dedupKey = rule.dedupKey(candidate);
      const anomalyId = await upsertAnomaly(admin, {
        ...candidate,
        dedupKey,
        runId: candidate.runId ?? null,
      });

      detections.push({
        anomalyId,
        ruleKey: candidate.ruleKey,
        domain: candidate.domain,
        severity: candidate.severity,
        entityType: candidate.entityType ?? null,
        entityId: candidate.entityId ?? null,
        expectedValueCents: candidate.expectedValueCents ?? null,
        actualValueCents: candidate.actualValueCents ?? null,
        differenceCents: candidate.differenceCents ?? null,
        detectionSource: candidate.detectionSource,
        dedupKey,
        runId: candidate.runId ?? null,
        detail: candidate.detail,
      });
    }
  }

  if (detections.length > 0) {
    try {
      await notifyRealtimeAnomalies(admin, event.tenantId, detections);
    } catch (error) {
      defaultLogger.warn('[anomaly.realtimeSubscriber] notification failed', {
        tenantId: event.tenantId,
        action: event.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return detections;
}
