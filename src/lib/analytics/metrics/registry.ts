import type { SupabaseClient } from '@supabase/supabase-js';

export type MetricAggregation = 'sum' | 'count' | 'avg' | 'rank';

export interface MetricExecutionPlan {
  sql: string;
  args: unknown[];
  run(admin: SupabaseClient, tenantId: string): Promise<{
    summary?: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
    period?: Record<string, unknown> | null;
    limitations?: string[];
  }>;
}

export interface Metric {
  key: string;
  title: string;
  requiredPermission: string;
  allowedDimensions: string[];
  allowedFilters: string[];
  allowedAggregations: MetricAggregation[];
  build(params: Record<string, unknown>): MetricExecutionPlan;
}

export class MetricValidationError extends Error {}

export function createMetricRegistry(metrics: Metric[]): Record<string, Metric> {
  return Object.fromEntries(metrics.map((metric) => [metric.key, metric]));
}

export function validateMetricParams(metric: Metric, params: Record<string, unknown>) {
  const dimensions = Array.isArray(params.dimensions) ? params.dimensions : [];
  const filters = params.filters && typeof params.filters === 'object' ? params.filters as Record<string, unknown> : {};
  const aggregation = typeof params.aggregation === 'string' ? params.aggregation : null;

  for (const dimension of dimensions) {
    if (typeof dimension !== 'string' || !metric.allowedDimensions.includes(dimension)) {
      throw new MetricValidationError(`Unsupported dimension for ${metric.key}: ${String(dimension)}`);
    }
  }

  for (const filterKey of Object.keys(filters)) {
    if (!metric.allowedFilters.includes(filterKey)) {
      throw new MetricValidationError(`Unsupported filter for ${metric.key}: ${filterKey}`);
    }
  }

  if (aggregation && !metric.allowedAggregations.includes(aggregation as MetricAggregation)) {
    throw new MetricValidationError(`Unsupported aggregation for ${metric.key}: ${aggregation}`);
  }
}

function buildRevenueTotalMetric(): Metric {
  return {
    key: 'revenue_total',
    title: 'Revenue total',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: [],
    allowedFilters: ['period_start', 'period_end', 'subject_type'],
    allowedAggregations: ['sum'],
    build(params) {
      const filters = params.filters && typeof params.filters === 'object' ? params.filters as Record<string, unknown> : {};
      const periodStart = typeof filters.period_start === 'string' ? filters.period_start : null;
      const periodEnd = typeof filters.period_end === 'string' ? filters.period_end : null;
      const subjectType = typeof filters.subject_type === 'string' ? filters.subject_type : null;

      return {
        sql: [
          'select coalesce(sum(amount), 0) as total_amount',
          'from public.transactions',
          'where tenant_id = $1',
          "and status in ('success', 'paid', 'completed')",
          "and type in ('payment', 'deposit', 'sale')",
          subjectType ? 'and subject_type = $2' : '',
          periodStart ? `and created_at >= $${subjectType ? 3 : 2}` : '',
          periodEnd ? `and created_at < $${subjectType ? (periodStart ? 4 : 3) : (periodStart ? 3 : 2)}` : '',
        ].filter(Boolean).join(' '),
        args: ['tenant_id', ...(subjectType ? [subjectType] : []), ...(periodStart ? [periodStart] : []), ...(periodEnd ? [periodEnd] : [])],
        async run(admin, tenantId) {
          let query = admin
            .from('transactions')
            .select('amount')
            .eq('tenant_id', tenantId)
            .in('status', ['success', 'paid', 'completed'])
            .in('type', ['payment', 'deposit', 'sale']);

          if (subjectType) query = query.eq('subject_type', subjectType);
          if (periodStart) query = query.gte('created_at', periodStart);
          if (periodEnd) query = query.lt('created_at', periodEnd);

          const { data, error } = await query;
          if (error) throw error;

          const totalAmount = (data ?? []).reduce((sum, row: { amount?: number | string | null }) => {
            return sum + Number(row.amount ?? 0);
          }, 0);

          return {
            summary: { total_amount: totalAmount },
            rows: [{ total_amount: totalAmount }],
            period: { period_start: periodStart, period_end: periodEnd },
            limitations: [],
          };
        },
      };
    },
  };
}

export const METRICS = createMetricRegistry([
  buildRevenueTotalMetric(),
]);

export async function runMetric(
  admin: SupabaseClient,
  tenantId: string,
  key: string,
  params: Record<string, unknown>,
  registry: Record<string, Metric> = METRICS,
) {
  const metric = registry[key];
  if (!metric) {
    throw new MetricValidationError(`Unknown metric: ${key}`);
  }

  validateMetricParams(metric, params);
  const plan = metric.build(params);
  const result = await plan.run(admin, tenantId);
  return {
    metric,
    plan,
    result,
  };
}

