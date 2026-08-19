import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const mockNlToMetric = jest.fn();
const mockRunMetric = jest.fn();
const mockMetrics = {
  revenue_total: { requiredPermission: BOOKA_PERMISSIONS.VIEW_REVENUE },
};

jest.mock('./nlToMetric', () => ({
  nlToMetric: (...args: unknown[]) => mockNlToMetric(...args),
}));

jest.mock('./metrics/registry', () => ({
  runMetric: (...args: unknown[]) => mockRunMetric(...args),
  METRICS: mockMetrics,
}));

import { answerQuestion, MetricPermissionError } from './answer';

function makeAdmin() {
  const insert = jest.fn().mockResolvedValue({ data: null, error: null });
  const maybeSingle = jest.fn().mockResolvedValue({ data: { timezone: 'Africa/Lagos' }, error: null });
  const from = jest.fn((table: string) => {
    if (table === 'tenants') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle,
      };
    }

    if (table === 'analytics_query_log') {
      return { insert };
    }

    throw new Error(`Unexpected table ${table}`);
  });

  return { admin: { from } as never, insert, maybeSingle, from };
}

describe('answerQuestion', () => {
  beforeEach(() => {
    mockNlToMetric.mockReset();
    mockRunMetric.mockReset();
  });

  it('returns a clarification without running a metric when mapping is unclear', async () => {
    const { admin, insert } = makeAdmin();
    mockNlToMetric.mockResolvedValue({ clarification: 'Please clarify your question.' });

    const result = await answerQuestion(admin, 'tenant-1', '???', {
      actorId: 'actor-1',
      permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS],
    });

    expect(result).toEqual({
      clarification: 'Please clarify your question.',
      rows: [],
      limitations: [],
      text: 'Please clarify your question.',
    });
    expect(mockRunMetric).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('runs a mapped metric and logs the query', async () => {
    const { admin, insert } = makeAdmin();
    mockNlToMetric.mockResolvedValue({
      metricKey: 'revenue_total',
      params: { aggregation: 'sum', filters: { period_start: '2026-07-21T00:00:00' } },
    });
    mockRunMetric.mockResolvedValue({
      metric: { requiredPermission: BOOKA_PERMISSIONS.VIEW_REVENUE },
      result: {
        summary: { total_amount: 1250 },
        rows: [{ total_amount: 1250 }],
        period: { period_start: '2026-07-21T00:00:00', period_end: '2026-07-22T00:00:00' },
        limitations: [],
      },
    });

    const result = await answerQuestion(admin, 'tenant-1', 'How much did we make today?', {
      actorId: 'actor-1',
      permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS, BOOKA_PERMISSIONS.VIEW_REVENUE],
    });

    expect(result.metricKey).toBe('revenue_total');
    expect(result.summary).toEqual({ total_amount: 1250 });
    expect(result.text).toContain('Total Amount: 1,250');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        actor_id: 'actor-1',
        question: 'How much did we make today?',
        metric_key: 'revenue_total',
      }),
    );
  });

  it('blocks revenue metrics when the caller lacks revenue permission', async () => {
    const { admin } = makeAdmin();
    mockNlToMetric.mockResolvedValue({
      metricKey: 'revenue_total',
      params: { aggregation: 'sum', filters: {} },
    });
    mockRunMetric.mockResolvedValue({
      metric: { requiredPermission: BOOKA_PERMISSIONS.VIEW_REVENUE },
      result: { summary: {}, rows: [], period: null, limitations: [] },
    });

    await expect(
      answerQuestion(admin, 'tenant-1', 'How much did we make today?', {
        actorId: 'actor-1',
        permissions: [BOOKA_PERMISSIONS.VIEW_ANALYTICS],
      }),
    ).rejects.toThrow(new MetricPermissionError('You are not allowed to view revenue analytics.'));
  });
});
