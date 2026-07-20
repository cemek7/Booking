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

export const RULES: AnomalyRule[] = [
  ...inventoryRules,
  ...serviceRules,
  ...retailRules,
];

export async function runRules(
  admin: SupabaseClient,
  tenantId: string,
  trigger: 'batch' | 'realtime',
  ctx: RuleContext
): Promise<string[]> {
  const ids: string[] = [];
  const matchingRules = RULES.filter((rule) => {
    if (rule.mode !== 'both' && rule.mode !== trigger) return false;
    if (trigger === 'realtime' && rule.triggerActions?.length && ctx.eventAction) {
      return rule.triggerActions.includes(ctx.eventAction);
    }
    return trigger === 'batch' || !rule.triggerActions?.length || !ctx.eventAction;
  });

  for (const rule of matchingRules) {
    const candidates = await rule.detect(admin, tenantId, ctx.window, ctx);
    for (const candidate of candidates) {
      const anomalyId = await upsertAnomaly(admin, {
        ...candidate,
        dedupKey: rule.dedupKey(candidate),
        runId: candidate.runId ?? ctx.runId ?? null,
      });
      ids.push(anomalyId);
    }
  }

  return ids;
}
