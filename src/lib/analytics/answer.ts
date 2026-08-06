import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKA_PERMISSIONS } from '@/types/permissions';
import { nlToMetric } from './nlToMetric';
import { METRICS, runMetric } from './metrics/registry';

export class MetricPermissionError extends Error {}

interface AnswerOptions {
  actorId?: string | null;
  permissions?: Iterable<string>;
  timezone?: string | null;
}

export interface AnalyticsAnswer {
  metricKey?: string;
  summary?: Record<string, unknown> | null;
  rows: Array<Record<string, unknown>>;
  period?: Record<string, unknown> | null;
  limitations?: string[];
  clarification?: string;
  text: string;
}

function getPermissionSet(permissions?: Iterable<string>) {
  return new Set(permissions ?? []);
}

function formatValue(value: unknown) {
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (typeof value === 'string') return value;
  if (value == null) return 'n/a';
  return String(value);
}

function titleize(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatAnalyticsAnswer(answer: Omit<AnalyticsAnswer, 'text'>): string {
  if (answer.clarification) return answer.clarification;

  const summary = answer.summary ?? {};
  const summaryLines = Object.entries(summary).map(([key, value]) => `${titleize(key)}: ${formatValue(value)}`);
  const rowLines = (answer.rows ?? []).slice(0, 5).map((row) => {
    const parts = Object.entries(row).map(([key, value]) => `${titleize(key)} ${formatValue(value)}`);
    return `• ${parts.join(' | ')}`;
  });
  const limitationLines = (answer.limitations ?? []).map((line) => `Note: ${line}`);

  return [...summaryLines, ...rowLines, ...limitationLines].filter(Boolean).join('\n');
}

export async function answerQuestion(
  admin: SupabaseClient,
  tenantId: string,
  question: string,
  options: AnswerOptions = {},
): Promise<AnalyticsAnswer> {
  const start = Date.now();
  const permissions = getPermissionSet(options.permissions);

  const timezone = options.timezone ?? (
    await admin
      .from('tenants')
      .select('timezone')
      .eq('id', tenantId)
      .maybeSingle()
      .then(({ data }) => (typeof data?.timezone === 'string' ? data.timezone : 'Africa/Lagos'))
  );

  const mapped = await nlToMetric(question, { timezone: timezone ?? 'Africa/Lagos' });
  if ('clarification' in mapped) {
    return {
      clarification: mapped.clarification,
      rows: [],
      limitations: [],
      text: mapped.clarification,
    };
  }

  const metric = METRICS[mapped.metricKey];
  if (!metric) {
    throw new Error(`Unknown metric: ${mapped.metricKey}`);
  }

  const requiredPermission = metric.requiredPermission;

  if (
    requiredPermission === BOOKA_PERMISSIONS.VIEW_ANALYTICS && !permissions.has(BOOKA_PERMISSIONS.VIEW_ANALYTICS)
  ) {
    throw new MetricPermissionError('You are not allowed to view analytics.');
  }

  if (
    requiredPermission === BOOKA_PERMISSIONS.VIEW_REVENUE && !permissions.has(BOOKA_PERMISSIONS.VIEW_REVENUE)
  ) {
    throw new MetricPermissionError('You are not allowed to view revenue analytics.');
  }

  const execution = await runMetric(admin, tenantId, mapped.metricKey, mapped.params);

  const rowCount = execution.result.rows.length;
  const latency = Date.now() - start;

  await admin.from('analytics_query_log').insert({
    tenant_id: tenantId,
    actor_id: options.actorId ?? null,
    question,
    metric_key: mapped.metricKey,
    params: mapped.params,
    row_count: rowCount,
    latency_ms: latency,
  });

  const answer = {
    metricKey: mapped.metricKey,
    summary: execution.result.summary ?? null,
    rows: execution.result.rows,
    period: execution.result.period ?? null,
    limitations: execution.result.limitations ?? [],
  };

  return {
    ...answer,
    text: formatAnalyticsAnswer(answer),
  };
}
