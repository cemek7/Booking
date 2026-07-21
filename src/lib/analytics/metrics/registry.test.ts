import { MetricValidationError, METRICS, runMetric, validateMetricParams } from './registry';

describe('analytics metric registry', () => {
  it('rejects unsupported dimensions', () => {
    expect(() =>
      validateMetricParams(METRICS.revenue_total, {
        dimensions: ['staff'],
        filters: {},
        aggregation: 'sum',
      }),
    ).toThrow(new MetricValidationError('Unsupported dimension for revenue_total: staff'));
  });

  it('rejects unsupported filters', () => {
    expect(() =>
      validateMetricParams(METRICS.revenue_total, {
        filters: { invalid_filter: true },
        aggregation: 'sum',
      }),
    ).toThrow(new MetricValidationError('Unsupported filter for revenue_total: invalid_filter'));
  });

  it('rejects unsupported aggregations', () => {
    expect(() =>
      validateMetricParams(METRICS.revenue_total, {
        filters: {},
        aggregation: 'count',
      }),
    ).toThrow(new MetricValidationError('Unsupported aggregation for revenue_total: count'));
  });

  it('rejects unknown metrics', async () => {
    await expect(
      runMetric({} as never, 'tenant-1', 'not_real', {}),
    ).rejects.toThrow(new MetricValidationError('Unknown metric: not_real'));
  });

  it('runs revenue_total against a tenant-scoped transaction query', async () => {
    const terminalQuery = {
      data: [
        { amount: 1500 },
        { amount: '500' },
        { amount: null },
      ],
      error: null,
    };

    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lt: jest.fn().mockResolvedValue(terminalQuery),
    };

    const admin = {
      from: jest.fn().mockReturnValue(query),
    } as never;

    const response = await runMetric(
      admin,
      'tenant-123',
      'revenue_total',
      {
        filters: {
          subject_type: 'reservation',
          period_start: '2026-07-01T00:00:00.000Z',
          period_end: '2026-08-01T00:00:00.000Z',
        },
        aggregation: 'sum',
      },
    );

    expect(admin.from).toHaveBeenCalledWith('transactions');
    expect(query.select).toHaveBeenCalledWith('amount');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-123');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'subject_type', 'reservation');
    expect(query.in).toHaveBeenNthCalledWith(1, 'status', ['success', 'paid', 'completed']);
    expect(query.in).toHaveBeenNthCalledWith(2, 'type', ['payment', 'deposit', 'sale']);
    expect(query.gte).toHaveBeenCalledWith('created_at', '2026-07-01T00:00:00.000Z');
    expect(query.lt).toHaveBeenCalledWith('created_at', '2026-08-01T00:00:00.000Z');
    expect(response.result.summary).toEqual({ total_amount: 2000 });
    expect(response.result.rows).toEqual([{ total_amount: 2000 }]);
    expect(response.result.period).toEqual({
      period_start: '2026-07-01T00:00:00.000Z',
      period_end: '2026-08-01T00:00:00.000Z',
    });
  });
});
