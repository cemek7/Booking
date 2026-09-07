import { callOpenRouter } from '@/lib/openrouter';
import { callGoogleAI, isGoogleAIConfigured } from '@/lib/google-ai';
import { METRICS } from './metrics/registry';

export interface MetricQuestionMapping {
  metricKey: string;
  params: Record<string, unknown>;
}

export interface MetricClarification {
  clarification: string;
}

type MappingResult = MetricQuestionMapping | MetricClarification;

function localDateString(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function resolveNamedPeriod(label: string | null | undefined, timezone: string, now = new Date()) {
  const normalized = String(label ?? '').trim().toLowerCase();
  const today = localDateString(timezone, now);
  const dayStart = `${today}T00:00:00`;

  if (normalized === 'today') {
    const date = new Date(`${today}T00:00:00Z`);
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      period_start: dayStart,
      period_end: `${next.toISOString().slice(0, 10)}T00:00:00`,
    };
  }

  if (normalized === 'this_week') {
    const date = new Date(`${today}T00:00:00Z`);
    const day = date.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - diff);
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 7);
    return {
      period_start: `${date.toISOString().slice(0, 10)}T00:00:00`,
      period_end: `${next.toISOString().slice(0, 10)}T00:00:00`,
    };
  }

  if (normalized === 'this_month') {
    const date = new Date(`${today}T00:00:00Z`);
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return {
      period_start: `${start.toISOString().slice(0, 10)}T00:00:00`,
      period_end: `${next.toISOString().slice(0, 10)}T00:00:00`,
    };
  }

  return null;
}

function parseAssistantJson(content: string | null) {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function buildPrompt(question: string) {
  const metrics = Object.values(METRICS).map((metric) => ({
    key: metric.key,
    title: metric.title,
    dimensions: metric.allowedDimensions,
    filters: metric.allowedFilters,
    aggregations: metric.allowedAggregations,
  }));

  return [
    'Map the owner question to exactly one approved metric.',
    'Return JSON only.',
    'Allowed shape:',
    '{"metricKey":"metric_key","params":{"dimensions":[],"filters":{},"aggregation":"sum"}}',
    'If the question cannot be mapped safely, return {"clarification":"..."} instead.',
    'Never generate SQL.',
    `Approved metrics: ${JSON.stringify(metrics)}`,
    `Question: ${question}`,
  ].join('\n');
}

function heuristicMap(question: string, timezone: string): MappingResult {
  const normalized = question.trim().toLowerCase();
  const period = normalized.includes('today')
    ? resolveNamedPeriod('today', timezone)
    : normalized.includes('this week') || normalized.includes('week')
      ? resolveNamedPeriod('this_week', timezone)
      : normalized.includes('this month') || normalized.includes('month')
        ? resolveNamedPeriod('this_month', timezone)
        : null;

  if (normalized.includes('how much') && (normalized.includes('make') || normalized.includes('revenue'))) {
    return {
      metricKey: 'revenue_total',
      params: {
        filters: period ?? {},
        aggregation: 'sum',
      },
    };
  }

  if (normalized.includes('revenue by day')) {
    return {
      metricKey: 'revenue_by_day',
      params: {
        dimensions: ['date'],
        filters: period ?? {},
        aggregation: 'sum',
      },
    };
  }

  if (normalized.includes('outstanding')) {
    return {
      metricKey: 'outstanding_total',
      params: { aggregation: 'sum' },
    };
  }

  if (normalized.includes('top products')) {
    return {
      metricKey: 'top_products',
      params: { dimensions: ['product'], filters: { limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('dead stock')) {
    return {
      metricKey: 'dead_stock',
      params: { dimensions: ['product'], filters: { ...(period ?? {}), limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('low stock')) {
    return {
      metricKey: 'low_stock',
      params: { dimensions: ['product'], filters: { limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('top customers')) {
    return {
      metricKey: 'top_customers',
      params: { dimensions: ['customer'], filters: { limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('lapsed customers')) {
    return {
      metricKey: 'lapsed_customers',
      params: { dimensions: ['customer'], filters: { threshold_days: 60, limit: 25 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('top services')) {
    return {
      metricKey: 'top_services',
      params: { dimensions: ['service'], filters: { limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('service revenue per hour')) {
    return {
      metricKey: 'service_revenue_per_hour',
      params: { dimensions: ['service'], filters: { limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('staff revenue') || normalized.includes('who sold the most')) {
    return {
      metricKey: 'staff_revenue',
      params: { dimensions: ['staff'], filters: { limit: 10 }, aggregation: 'rank' },
    };
  }

  if (normalized.includes('staff discounts') || normalized.includes('who discounted')) {
    return {
      metricKey: 'staff_discounts',
      params: { dimensions: ['staff'], filters: { ...(period ?? {}), limit: 10 }, aggregation: 'rank' },
    };
  }

  return {
    clarification: 'I can answer revenue, stock, customer, service, and staff performance questions. Please be more specific.',
  };
}

export async function nlToMetric(
  question: string,
  options: { timezone?: string } = {},
): Promise<MappingResult> {
  const timezone = options.timezone ?? 'Africa/Lagos';
  const fallback = heuristicMap(question, timezone);

  const prompt = buildPrompt(question);

  try {
    const response = isGoogleAIConfigured()
      ? await callGoogleAI([{ role: 'user', content: prompt }], undefined, 1)
      : await callOpenRouter([{ role: 'system', content: 'Return JSON only.' }, { role: 'user', content: prompt }], undefined, 1);

    const content = (response.json as Record<string, unknown>)?.choices
      ? ((((response.json as Record<string, unknown>).choices as Array<Record<string, unknown>>)[0]?.message as Record<string, unknown> | undefined)?.content as string | null)
      : ((((response.json as Record<string, unknown>).candidates as Array<Record<string, unknown>> | undefined)?.[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined)?.[0]?.text as string | null;

    const parsed = parseAssistantJson(content);
    if (!parsed || typeof parsed !== 'object') return fallback;

    if (typeof (parsed as Record<string, unknown>).clarification === 'string') {
      return { clarification: (parsed as Record<string, unknown>).clarification as string };
    }

    const metricKey = typeof (parsed as Record<string, unknown>).metricKey === 'string'
      ? (parsed as Record<string, unknown>).metricKey as string
      : null;

    if (!metricKey || !METRICS[metricKey]) {
      return fallback;
    }

    const rawParams = ((parsed as Record<string, unknown>).params as Record<string, unknown> | undefined) ?? {};
    const rawFilters = rawParams.filters && typeof rawParams.filters === 'object'
      ? (rawParams.filters as Record<string, unknown>)
      : {};
    const periodLabel = typeof rawFilters.period === 'string' ? rawFilters.period : null;
    const resolvedPeriod = periodLabel ? resolveNamedPeriod(periodLabel, timezone) : null;

    return {
      metricKey,
      params: {
        dimensions: Array.isArray(rawParams.dimensions) ? rawParams.dimensions : [],
        aggregation: typeof rawParams.aggregation === 'string' ? rawParams.aggregation : undefined,
        filters: {
          ...rawFilters,
          ...(resolvedPeriod ?? {}),
        },
      },
    };
  } catch {
    return fallback;
  }
}
