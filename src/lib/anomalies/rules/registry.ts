import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertAnomaly, type AnomalyCandidate, type AnomalyDomain, type AnomalySeverity } from '../upsertAnomaly';
import { inventoryRules } from './inventory';
import { retailRules } from './retail';
import { serviceRules } from './service';

export interface RuleWindow {
  startUtc: string;
  endUtc: string;
  rolloutCutoffUtc?: string;
}

export interface RuleContext {
  window: RuleWindow;
  runId?: string | null;
  eventAction?: string;
  eventMetadata?: Record<string, unknown> | null;
}

export interface AnomalyRule {
  key: string;
  domain: AnomalyDomain;
  severity: AnomalySeverity;
  mode: 'batch' | 'realtime' | 'both';
  triggerActions?: string[];
  detect(
    admin: SupabaseClient,
    tenantId: string,
    window: RuleWindow,
    ctx: RuleContext
  ): Promise<AnomalyCandidate[]>;
  dedupKey(candidate: AnomalyCandidate): string;
}

export interface DetectedAnomaly {
  anomalyId: string;
  ruleKey: string;
  domain: AnomalyDomain;
  severity: AnomalySeverity;
  entityType?: string | null;
  entityId?: string | null;
  expectedValueCents?: number | null;
  actualValueCents?: number | null;
  differenceCents?: number | null;
  detectionSource: AnomalyCandidate['detectionSource'];
  dedupKey: string;
  runId?: string | null;
  detail?: Record<string, unknown>;
}

export const RULES: AnomalyRule[] = [
  ...inventoryRules,
  ...serviceRules,
  ...retailRules,
];

export function getMatchingRules(
  trigger: 'batch' | 'realtime',
  ctx: RuleContext
): AnomalyRule[] {
  return RULES.filter((rule) => {
    if (rule.mode !== 'both' && rule.mode !== trigger) return false;
    if (trigger === 'realtime' && rule.triggerActions?.length && ctx.eventAction) {
      return rule.triggerActions.includes(ctx.eventAction);
    }
    return trigger === 'batch' || !rule.triggerActions?.length || !ctx.eventAction;
  });
}

export async function runRules(
  admin: SupabaseClient,
  tenantId: string,
  trigger: 'batch' | 'realtime',
  ctx: RuleContext
): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];
  const matchingRules = getMatchingRules(trigger, ctx);

  for (const rule of matchingRules) {
    const candidates = await rule.detect(admin, tenantId, ctx.window, ctx);
    for (const candidate of candidates) {
      const dedupKey = rule.dedupKey(candidate);
      const anomalyId = await upsertAnomaly(admin, {
        ...candidate,
        dedupKey,
        runId: candidate.runId ?? ctx.runId ?? null,
      });
      results.push({
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
        runId: candidate.runId ?? ctx.runId ?? null,
        detail: candidate.detail,
      });
    }
  }

  return results;
}
