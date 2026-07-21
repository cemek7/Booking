import { describe, expect, it, jest } from '@jest/globals';
import { MetricValidationError, METRICS, runMetric, validateMetricParams } from './registry';

type Row = Record<string, unknown>;

function makeQuery(rows: Row[]) {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
      return Promise.resolve(resolve({ data: rows, error: null }));
    },
  };

  return query;
}

function makeAdmin(fixtures: Record<string, Row[]>) {
  const queries = new Map<string, ReturnType<typeof makeQuery>>();

  const admin = {
    from: jest.fn((table: string) => {
      const query = makeQuery(fixtures[table] ?? []);
      queries.set(table, query);
      return query;
    }),
  } as never;

  return {
    admin,
    queries,
  };
}

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
    await expect(runMetric({} as never, 'tenant-1', 'not_real', {})).rejects.toThrow(
      new MetricValidationError('Unknown metric: not_real'),
    );
  });

  it('runs revenue_total against a tenant-scoped transaction query', async () => {
    const { admin, queries } = makeAdmin({
      transactions: [{ amount: 1500 }, { amount: '500' }, { amount: null }],
    });

    const response = await runMetric(admin, 'tenant-123', 'revenue_total', {
      filters: {
        subject_type: 'reservation',
        period_start: '2026-07-01T00:00:00.000Z',
        period_end: '2026-08-01T00:00:00.000Z',
      },
      aggregation: 'sum',
    });

    const query = queries.get('transactions');
    expect(admin.from).toHaveBeenCalledWith('transactions');
    expect(query?.select).toHaveBeenCalledWith('amount');
    expect(query?.eq).toHaveBeenNthCalledWith(1, 'tenant_id', 'tenant-123');
    expect(query?.eq).toHaveBeenNthCalledWith(2, 'subject_type', 'reservation');
    expect(query?.in).toHaveBeenNthCalledWith(1, 'status', ['success', 'paid', 'completed']);
    expect(query?.in).toHaveBeenNthCalledWith(2, 'type', ['payment', 'deposit', 'sale']);
    expect(query?.gte).toHaveBeenCalledWith('created_at', '2026-07-01T00:00:00.000Z');
    expect(query?.lt).toHaveBeenCalledWith('created_at', '2026-08-01T00:00:00.000Z');
    expect(response.result.summary).toEqual({ total_amount: 2000 });
    expect(response.result.rows).toEqual([{ total_amount: 2000 }]);
  });

  it('runs revenue_by_day from daily insight rows', async () => {
    const { admin } = makeAdmin({
      insights_daily: [
        { date: '2026-07-18', revenue: 1250 },
        { date: '2026-07-19', revenue: 850 },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'revenue_by_day', {
      dimensions: ['date'],
      filters: {
        period_start: '2026-07-18',
        period_end: '2026-07-20',
      },
      aggregation: 'sum',
    });

    expect(response.result.summary).toEqual({ total_revenue: 2100 });
    expect(response.result.rows).toEqual([
      { date: '2026-07-18', revenue: 1250 },
      { date: '2026-07-19', revenue: 850 },
    ]);
  });

  it('runs outstanding_total from customer profile balances', async () => {
    const { admin } = makeAdmin({
      customer_profile_summary: [
        { outstanding_balance_cents: 125000 },
        { outstanding_balance_cents: '25000' },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'outstanding_total', {
      aggregation: 'sum',
    });

    expect(response.result.summary).toEqual({ total_outstanding: 1500 });
    expect(response.result.rows).toEqual([{ total_outstanding: 1500 }]);
  });

  it('ranks top_products from paid retail orders', async () => {
    const { admin } = makeAdmin({
      retail_orders: [{ id: 'o1' }, { id: 'o2' }],
      retail_order_items: [
        { order_id: 'o1', product_id: 'p1', quantity: 3, total_price_cents: 4500 },
        { order_id: 'o2', product_id: 'p2', quantity: 1, total_price_cents: 3000 },
        { order_id: 'o2', product_id: 'p1', quantity: 2, total_price_cents: 3000 },
      ],
      products: [
        { id: 'p1', name: 'Relaxer' },
        { id: 'p2', name: 'Hair Oil' },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'top_products', {
      dimensions: ['product'],
      filters: { limit: 2 },
      aggregation: 'rank',
    });

    expect(response.result.rows).toEqual([
      { product_id: 'p1', product_name: 'Relaxer', quantity: 5, revenue: 75 },
      { product_id: 'p2', product_name: 'Hair Oil', quantity: 1, revenue: 30 },
    ]);
  });

  it('finds dead_stock from unsold tracked inventory', async () => {
    const { admin } = makeAdmin({
      products: [
        { id: 'p1', name: 'Relaxer', stock_quantity: 8, low_stock_threshold: 2, price_cents: 2500 },
        { id: 'p2', name: 'Hair Oil', stock_quantity: 5, low_stock_threshold: 1, price_cents: 3000 },
      ],
      retail_orders: [{ id: 'o1' }],
      retail_order_items: [{ order_id: 'o1', product_id: 'p2' }],
    });

    const response = await runMetric(admin, 'tenant-1', 'dead_stock', {
      dimensions: ['product'],
      filters: { limit: 5 },
      aggregation: 'rank',
    });

    expect(response.result.rows).toEqual([
      {
        product_id: 'p1',
        product_name: 'Relaxer',
        stock_quantity: 8,
        stock_value: 200,
        low_stock_threshold: 2,
      },
    ]);
  });

  it('finds low_stock products', async () => {
    const { admin } = makeAdmin({
      products: [
        { id: 'p1', name: 'Relaxer', stock_quantity: 1, low_stock_threshold: 3 },
        { id: 'p2', name: 'Hair Oil', stock_quantity: 4, low_stock_threshold: 2 },
        { id: 'p3', name: 'Shampoo', stock_quantity: 0, low_stock_threshold: 1 },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'low_stock', {
      dimensions: ['product'],
      filters: { limit: 5 },
      aggregation: 'rank',
    });

    expect(response.result.rows).toEqual([
      { product_id: 'p3', product_name: 'Shampoo', stock_quantity: 0, low_stock_threshold: 1 },
      { product_id: 'p1', product_name: 'Relaxer', stock_quantity: 1, low_stock_threshold: 3 },
    ]);
  });

  it('ranks top_customers by lifetime value', async () => {
    const { admin } = makeAdmin({
      customer_profile_summary: [
        {
          customer_id: 'c1',
          customer_name: 'Ada',
          lifetime_bookings: 5,
          lifetime_value_cents: 450000,
          outstanding_balance_cents: 0,
          last_visit: '2026-07-18T12:00:00.000Z',
        },
        {
          customer_id: 'c2',
          customer_name: 'Bola',
          lifetime_bookings: 3,
          lifetime_value_cents: 125000,
          outstanding_balance_cents: 25000,
          last_visit: '2026-07-17T12:00:00.000Z',
        },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'top_customers', {
      dimensions: ['customer'],
      filters: { limit: 5 },
      aggregation: 'rank',
    });

    expect(response.result.rows[0]).toEqual({
      customer_id: 'c1',
      customer_name: 'Ada',
      lifetime_bookings: 5,
      lifetime_value: 4500,
      outstanding_balance: 0,
      last_visit: '2026-07-18T12:00:00.000Z',
    });
  });

  it('finds lapsed_customers by threshold', async () => {
    const { admin } = makeAdmin({
      customer_profile_summary: [
        { customer_id: 'c1', customer_name: 'Ada', days_since_visit: 20, lifetime_bookings: 2, last_visit: '2026-07-01T00:00:00.000Z' },
        { customer_id: 'c2', customer_name: 'Bola', days_since_visit: 95, lifetime_bookings: 7, last_visit: '2026-04-01T00:00:00.000Z' },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'lapsed_customers', {
      dimensions: ['customer'],
      filters: { threshold_days: 60 },
      aggregation: 'rank',
    });

    expect(response.result.summary).toEqual({ lapsed_customer_count: 1, threshold_days: 60 });
    expect(response.result.rows).toEqual([
      {
        customer_id: 'c2',
        customer_name: 'Bola',
        days_since_visit: 95,
        last_visit: '2026-04-01T00:00:00.000Z',
        lifetime_bookings: 7,
      },
    ]);
  });

  it('ranks top_services by revenue', async () => {
    const { admin } = makeAdmin({
      service_performance_summary: [
        { service_id: 's1', bookings: 10, revenue: 2500, completion_rate: 0.9 },
        { service_id: 's2', bookings: 12, revenue: 1800, completion_rate: 0.95 },
      ],
      services: [
        { id: 's1', name: 'Braids' },
        { id: 's2', name: 'Pedicure' },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'top_services', {
      dimensions: ['service'],
      filters: { limit: 5 },
      aggregation: 'rank',
    });

    expect(response.result.rows[0]).toEqual({
      service_id: 's1',
      service_name: 'Braids',
      bookings: 10,
      revenue: 2500,
      completion_rate: 0.9,
    });
  });

  it('computes service_revenue_per_hour from service duration', async () => {
    const { admin } = makeAdmin({
      service_performance_summary: [
        { service_id: 's1', bookings: 4, revenue: 2000 },
        { service_id: 's2', bookings: 3, revenue: 1500 },
      ],
      services: [
        { id: 's1', name: 'Braids', duration_minutes: 120 },
        { id: 's2', name: 'Pedicure', duration_minutes: 60 },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'service_revenue_per_hour', {
      dimensions: ['service'],
      filters: { limit: 5 },
      aggregation: 'rank',
    });

    expect(response.result.rows[0]).toEqual({
      service_id: 's2',
      service_name: 'Pedicure',
      bookings: 3,
      revenue: 1500,
      duration_minutes: 60,
      revenue_per_hour: 500,
    });
  });

  it('ranks staff_revenue from staff summaries', async () => {
    const { admin } = makeAdmin({
      staff_performance_summary: [
        { staff_id: 'st1', bookings: 8, estimated_revenue: 2200, completion_rate: 0.9 },
        { staff_id: 'st2', bookings: 5, estimated_revenue: 1800, completion_rate: 1 },
      ],
      tenant_users: [
        { id: 'st1', name: 'Amaka' },
        { id: 'st2', name: 'Tunde' },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'staff_revenue', {
      dimensions: ['staff'],
      filters: { limit: 5 },
      aggregation: 'rank',
    });

    expect(response.result.rows[0]).toEqual({
      staff_id: 'st1',
      staff_name: 'Amaka',
      bookings: 8,
      revenue: 2200,
      completion_rate: 0.9,
    });
  });

  it('ranks staff_discounts from discounted reservations', async () => {
    const { admin } = makeAdmin({
      reservations: [
        { tenant_staff_id: 'st1', discount_cents: 2000 },
        { tenant_staff_id: 'st1', discount_cents: 1000 },
        { tenant_staff_id: 'st2', discount_cents: 500 },
      ],
      tenant_users: [
        { id: 'st1', name: 'Amaka' },
        { id: 'st2', name: 'Tunde' },
      ],
    });

    const response = await runMetric(admin, 'tenant-1', 'staff_discounts', {
      dimensions: ['staff'],
      filters: {
        period_start: '2026-07-01T00:00:00.000Z',
        period_end: '2026-08-01T00:00:00.000Z',
        limit: 5,
      },
      aggregation: 'rank',
    });

    expect(response.result.rows).toEqual([
      {
        staff_id: 'st1',
        staff_name: 'Amaka',
        discount_total: 30,
        discounted_reservations: 2,
      },
      {
        staff_id: 'st2',
        staff_name: 'Tunde',
        discount_total: 5,
        discounted_reservations: 1,
      },
    ]);
  });
});
