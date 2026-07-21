import type { SupabaseClient } from '@supabase/supabase-js';

export type MetricAggregation = 'sum' | 'count' | 'avg' | 'rank';

export interface MetricExecutionResult {
  summary?: Record<string, unknown> | null;
  rows: Array<Record<string, unknown>>;
  period?: Record<string, unknown> | null;
  limitations?: string[];
}

export interface MetricExecutionPlan {
  sql: string;
  args: unknown[];
  run(admin: SupabaseClient, tenantId: string): Promise<MetricExecutionResult>;
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

type Filters = Record<string, unknown>;

interface PeriodFilters {
  periodStart: string | null;
  periodEnd: string | null;
}

export class MetricValidationError extends Error {}

function getFilters(params: Record<string, unknown>): Filters {
  return params.filters && typeof params.filters === 'object'
    ? (params.filters as Filters)
    : {};
}

function getPeriodFilters(filters: Filters): PeriodFilters {
  return {
    periodStart: typeof filters.period_start === 'string' ? filters.period_start : null,
    periodEnd: typeof filters.period_end === 'string' ? filters.period_end : null,
  };
}

function parseThresholdDays(filters: Filters, fallback = 60) {
  const raw = filters.threshold_days;
  const value = typeof raw === 'number' ? raw : Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nairaFromCents(value: number | string | null | undefined) {
  return Number(value ?? 0) / 100;
}

function numberValue(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

async function fetchRows<T extends Record<string, unknown>>(
  query: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message ?? 'Metric query failed');
  }
  return data ?? [];
}

function createLimitRows<T extends Record<string, unknown>>(rows: T[], limit = 10) {
  return rows.slice(0, limit);
}

function applyCreatedAtRange<T extends {
  gte(column: string, value: string): T;
  lt(column: string, value: string): T;
}>(query: T, period: PeriodFilters, column = 'created_at') {
  let scoped = query;
  if (period.periodStart) scoped = scoped.gte(column, period.periodStart);
  if (period.periodEnd) scoped = scoped.lt(column, period.periodEnd);
  return scoped;
}

function createMetricRegistry(metrics: Metric[]): Record<string, Metric> {
  return Object.fromEntries(metrics.map((metric) => [metric.key, metric]));
}

export function validateMetricParams(metric: Metric, params: Record<string, unknown>) {
  const dimensions = Array.isArray(params.dimensions) ? params.dimensions : [];
  const filters = getFilters(params);
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
      const filters = getFilters(params);
      const period = getPeriodFilters(filters);
      const subjectType = typeof filters.subject_type === 'string' ? filters.subject_type : null;

      return {
        sql: [
          'select coalesce(sum(amount), 0) as total_amount',
          'from public.transactions',
          'where tenant_id = $1',
          "and status in ('success', 'paid', 'completed')",
          "and type in ('payment', 'deposit', 'sale')",
          subjectType ? 'and subject_type = $2' : '',
          period.periodStart ? `and created_at >= $${subjectType ? 3 : 2}` : '',
          period.periodEnd ? `and created_at < $${subjectType ? (period.periodStart ? 4 : 3) : (period.periodStart ? 3 : 2)}` : '',
        ].filter(Boolean).join(' '),
        args: ['tenant_id', ...(subjectType ? [subjectType] : []), ...(period.periodStart ? [period.periodStart] : []), ...(period.periodEnd ? [period.periodEnd] : [])],
        async run(admin, tenantId) {
          let query = admin
            .from('transactions')
            .select('amount')
            .eq('tenant_id', tenantId)
            .in('status', ['success', 'paid', 'completed'])
            .in('type', ['payment', 'deposit', 'sale']);

          if (subjectType) query = query.eq('subject_type', subjectType);
          query = applyCreatedAtRange(query, period);

          const data = await fetchRows<{ amount?: number | string | null }>(query);
          const totalAmount = data.reduce((sum, row) => sum + numberValue(row.amount), 0);

          return {
            summary: { total_amount: totalAmount },
            rows: [{ total_amount: totalAmount }],
            period: { period_start: period.periodStart, period_end: period.periodEnd },
            limitations: [],
          };
        },
      };
    },
  };
}

function buildRevenueByDayMetric(): Metric {
  return {
    key: 'revenue_by_day',
    title: 'Revenue by day',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: ['date'],
    allowedFilters: ['period_start', 'period_end'],
    allowedAggregations: ['sum'],
    build(params) {
      const filters = getFilters(params);
      const period = getPeriodFilters(filters);

      return {
        sql: [
          'select date, revenue',
          'from public.insights_daily',
          'where tenant_id = $1',
          period.periodStart ? 'and date >= $2::date' : '',
          period.periodEnd ? `and date < $${period.periodStart ? 3 : 2}::date` : '',
          'order by date asc',
        ].filter(Boolean).join(' '),
        args: ['tenant_id', ...(period.periodStart ? [period.periodStart] : []), ...(period.periodEnd ? [period.periodEnd] : [])],
        async run(admin, tenantId) {
          let query = admin
            .from('insights_daily')
            .select('date, revenue')
            .eq('tenant_id', tenantId);

          if (period.periodStart) query = query.gte('date', period.periodStart);
          if (period.periodEnd) query = query.lt('date', period.periodEnd);

          const data = await fetchRows<{ date: string; revenue?: number | string | null }>(
            query.order('date', { ascending: true }),
          );

          const rows = data.map((row) => ({
            date: row.date,
            revenue: numberValue(row.revenue),
          }));

          return {
            summary: { total_revenue: rows.reduce((sum, row) => sum + numberValue(row.revenue), 0) },
            rows,
            period: { period_start: period.periodStart, period_end: period.periodEnd },
            limitations: [],
          };
        },
      };
    },
  };
}

function buildOutstandingTotalMetric(): Metric {
  return {
    key: 'outstanding_total',
    title: 'Outstanding balances',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: [],
    allowedFilters: [],
    allowedAggregations: ['sum'],
    build() {
      return {
        sql: [
          'select coalesce(sum(outstanding_balance_cents), 0) as total_outstanding_cents',
          'from public.customer_profile_summary',
          'where tenant_id = $1',
        ].join(' '),
        args: ['tenant_id'],
        async run(admin, tenantId) {
          const data = await fetchRows<{ outstanding_balance_cents?: number | string | null }>(
            admin
              .from('customer_profile_summary')
              .select('outstanding_balance_cents')
              .eq('tenant_id', tenantId),
          );

          const totalOutstanding = data.reduce(
            (sum, row) => sum + nairaFromCents(row.outstanding_balance_cents),
            0,
          );

          return {
            summary: { total_outstanding: totalOutstanding },
            rows: [{ total_outstanding: totalOutstanding }],
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildTopProductsMetric(): Metric {
  return {
    key: 'top_products',
    title: 'Top products',
    requiredPermission: 'VIEW_ANALYTICS',
    allowedDimensions: ['product'],
    allowedFilters: ['period_start', 'period_end', 'limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const period = getPeriodFilters(filters);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'top_products_registry_pipeline',
        args: ['tenant_id', period.periodStart, period.periodEnd, limit],
        async run(admin, tenantId) {
          let ordersQuery = admin
            .from('retail_orders')
            .select('id')
            .eq('tenant_id', tenantId)
            .in('payment_status', ['paid', 'refunded'])
            .in('status', ['paid', 'fulfilled']);

          ordersQuery = applyCreatedAtRange(ordersQuery, period);

          const orders = await fetchRows<{ id: string }>(ordersQuery);
          const orderIds = orders.map((row) => row.id);
          if (orderIds.length === 0) {
            return { summary: { total_products_ranked: 0 }, rows: [], period, limitations: [] };
          }

          const items = await fetchRows<{
            order_id: string;
            product_id: string;
            quantity?: number | string | null;
            total_price_cents?: number | string | null;
          }>(
            admin
              .from('retail_order_items')
              .select('order_id, product_id, quantity, total_price_cents')
              .eq('tenant_id', tenantId)
              .in('order_id', orderIds),
          );

          const productIds = [...new Set(items.map((row) => row.product_id))];
          const products = await fetchRows<{ id: string; name?: string | null }>(
            admin
              .from('products')
              .select('id, name')
              .eq('tenant_id', tenantId)
              .in('id', productIds),
          );

          const productNames = new Map(products.map((product) => [product.id, product.name ?? 'Unnamed product']));
          const aggregates = new Map<string, { quantity: number; revenue: number }>();

          for (const item of items) {
            const current = aggregates.get(item.product_id) ?? { quantity: 0, revenue: 0 };
            current.quantity += numberValue(item.quantity);
            current.revenue += nairaFromCents(item.total_price_cents);
            aggregates.set(item.product_id, current);
          }

          const rows = createLimitRows(
            [...aggregates.entries()]
              .map(([productId, aggregate]) => ({
                product_id: productId,
                product_name: productNames.get(productId) ?? 'Unnamed product',
                quantity: aggregate.quantity,
                revenue: aggregate.revenue,
              }))
              .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue),
            limit,
          );

          return {
            summary: { total_products_ranked: rows.length },
            rows,
            period: { period_start: period.periodStart, period_end: period.periodEnd },
            limitations: [],
          };
        },
      };
    },
  };
}

function buildDeadStockMetric(): Metric {
  return {
    key: 'dead_stock',
    title: 'Dead stock',
    requiredPermission: 'VIEW_ANALYTICS',
    allowedDimensions: ['product'],
    allowedFilters: ['period_start', 'period_end', 'limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const period = getPeriodFilters(filters);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'dead_stock_registry_pipeline',
        args: ['tenant_id', period.periodStart, period.periodEnd, limit],
        async run(admin, tenantId) {
          const products = await fetchRows<{
            id: string;
            name?: string | null;
            stock_quantity?: number | string | null;
            low_stock_threshold?: number | string | null;
            price_cents?: number | string | null;
            track_inventory?: boolean | null;
            is_active?: boolean | null;
          }>(
            admin
              .from('products')
              .select('id, name, stock_quantity, low_stock_threshold, price_cents, track_inventory, is_active')
              .eq('tenant_id', tenantId)
              .eq('track_inventory', true)
              .eq('is_active', true),
          );

          let ordersQuery = admin
            .from('retail_orders')
            .select('id')
            .eq('tenant_id', tenantId)
            .in('payment_status', ['paid', 'refunded'])
            .in('status', ['paid', 'fulfilled']);
          ordersQuery = applyCreatedAtRange(ordersQuery, period);
          const orders = await fetchRows<{ id: string }>(ordersQuery);
          const orderIds = orders.map((row) => row.id);

          const soldItems = orderIds.length
            ? await fetchRows<{ product_id: string }>(
                admin
                  .from('retail_order_items')
                  .select('product_id')
                  .eq('tenant_id', tenantId)
                  .in('order_id', orderIds),
              )
            : [];

          const soldProductIds = new Set(soldItems.map((row) => row.product_id));
          const rows = createLimitRows(
            products
              .filter((product) => numberValue(product.stock_quantity) > 0 && !soldProductIds.has(product.id))
              .map((product) => ({
                product_id: product.id,
                product_name: product.name ?? 'Unnamed product',
                stock_quantity: numberValue(product.stock_quantity),
                stock_value: nairaFromCents(numberValue(product.stock_quantity) * numberValue(product.price_cents)),
                low_stock_threshold: numberValue(product.low_stock_threshold),
              }))
              .sort((a, b) => b.stock_value - a.stock_value || b.stock_quantity - a.stock_quantity),
            limit,
          );

          return {
            summary: { dead_stock_count: rows.length },
            rows,
            period: { period_start: period.periodStart, period_end: period.periodEnd },
            limitations: [],
          };
        },
      };
    },
  };
}

function buildLowStockMetric(): Metric {
  return {
    key: 'low_stock',
    title: 'Low stock',
    requiredPermission: 'VIEW_ANALYTICS',
    allowedDimensions: ['product'],
    allowedFilters: ['limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'low_stock_registry_pipeline',
        args: ['tenant_id', limit],
        async run(admin, tenantId) {
          const products = await fetchRows<{
            id: string;
            name?: string | null;
            stock_quantity?: number | string | null;
            low_stock_threshold?: number | string | null;
            track_inventory?: boolean | null;
            is_active?: boolean | null;
          }>(
            admin
              .from('products')
              .select('id, name, stock_quantity, low_stock_threshold, track_inventory, is_active')
              .eq('tenant_id', tenantId)
              .eq('track_inventory', true)
              .eq('is_active', true),
          );

          const rows = createLimitRows(
            products
              .filter((product) => {
                const threshold = numberValue(product.low_stock_threshold);
                const stock = numberValue(product.stock_quantity);
                return threshold > 0 && stock <= threshold;
              })
              .map((product) => ({
                product_id: product.id,
                product_name: product.name ?? 'Unnamed product',
                stock_quantity: numberValue(product.stock_quantity),
                low_stock_threshold: numberValue(product.low_stock_threshold),
              }))
              .sort((a, b) => a.stock_quantity - b.stock_quantity || a.low_stock_threshold - b.low_stock_threshold),
            limit,
          );

          return {
            summary: { low_stock_count: rows.length },
            rows,
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildTopCustomersMetric(): Metric {
  return {
    key: 'top_customers',
    title: 'Top customers',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: ['customer'],
    allowedFilters: ['limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'top_customers_registry_pipeline',
        args: ['tenant_id', limit],
        async run(admin, tenantId) {
          const data = await fetchRows<{
            customer_id: string;
            customer_name?: string | null;
            lifetime_bookings?: number | string | null;
            lifetime_value_cents?: number | string | null;
            last_visit?: string | null;
            outstanding_balance_cents?: number | string | null;
          }>(
            admin
              .from('customer_profile_summary')
              .select('customer_id, customer_name, lifetime_bookings, lifetime_value_cents, last_visit, outstanding_balance_cents')
              .eq('tenant_id', tenantId),
          );

          const rows = createLimitRows(
            data
              .map((row) => ({
                customer_id: row.customer_id,
                customer_name: row.customer_name ?? 'Unknown customer',
                lifetime_bookings: numberValue(row.lifetime_bookings),
                lifetime_value: nairaFromCents(row.lifetime_value_cents),
                outstanding_balance: nairaFromCents(row.outstanding_balance_cents),
                last_visit: row.last_visit,
              }))
              .sort((a, b) => b.lifetime_value - a.lifetime_value || b.lifetime_bookings - a.lifetime_bookings),
            limit,
          );

          return {
            summary: { total_customers_ranked: rows.length },
            rows,
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildLapsedCustomersMetric(): Metric {
  return {
    key: 'lapsed_customers',
    title: 'Lapsed customers',
    requiredPermission: 'VIEW_ANALYTICS',
    allowedDimensions: ['customer'],
    allowedFilters: ['threshold_days', 'limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const thresholdDays = parseThresholdDays(filters, 60);
      const limit = Math.max(1, Math.min(50, Number(filters.limit ?? 25)));

      return {
        sql: 'lapsed_customers_registry_pipeline',
        args: ['tenant_id', thresholdDays, limit],
        async run(admin, tenantId) {
          const data = await fetchRows<{
            customer_id: string;
            customer_name?: string | null;
            days_since_visit?: number | string | null;
            last_visit?: string | null;
            lifetime_bookings?: number | string | null;
          }>(
            admin
              .from('customer_profile_summary')
              .select('customer_id, customer_name, days_since_visit, last_visit, lifetime_bookings')
              .eq('tenant_id', tenantId),
          );

          const rows = createLimitRows(
            data
              .map((row) => ({
                customer_id: row.customer_id,
                customer_name: row.customer_name ?? 'Unknown customer',
                days_since_visit: numberValue(row.days_since_visit),
                last_visit: row.last_visit,
                lifetime_bookings: numberValue(row.lifetime_bookings),
              }))
              .filter((row) => row.days_since_visit >= thresholdDays)
              .sort((a, b) => b.days_since_visit - a.days_since_visit || b.lifetime_bookings - a.lifetime_bookings),
            limit,
          );

          return {
            summary: { lapsed_customer_count: rows.length, threshold_days: thresholdDays },
            rows,
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildTopServicesMetric(): Metric {
  return {
    key: 'top_services',
    title: 'Top services',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: ['service'],
    allowedFilters: ['limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'top_services_registry_pipeline',
        args: ['tenant_id', limit],
        async run(admin, tenantId) {
          const servicesSummary = await fetchRows<{
            service_id: string;
            bookings?: number | string | null;
            revenue?: number | string | null;
            completion_rate?: number | string | null;
          }>(
            admin
              .from('service_performance_summary')
              .select('service_id, bookings, revenue, completion_rate')
              .eq('tenant_id', tenantId),
          );

          const serviceIds = servicesSummary.map((row) => row.service_id);
          const services = serviceIds.length
            ? await fetchRows<{ id: string; name?: string | null }>(
                admin
                  .from('services')
                  .select('id, name')
                  .eq('tenant_id', tenantId)
                  .in('id', serviceIds),
              )
            : [];
          const serviceNames = new Map(services.map((service) => [service.id, service.name ?? 'Unnamed service']));

          const rows = createLimitRows(
            servicesSummary
              .map((row) => ({
                service_id: row.service_id,
                service_name: serviceNames.get(row.service_id) ?? 'Unnamed service',
                bookings: numberValue(row.bookings),
                revenue: numberValue(row.revenue),
                completion_rate: numberValue(row.completion_rate),
              }))
              .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings),
            limit,
          );

          return {
            summary: { total_services_ranked: rows.length },
            rows,
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildServiceRevenuePerHourMetric(): Metric {
  return {
    key: 'service_revenue_per_hour',
    title: 'Service revenue per hour',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: ['service'],
    allowedFilters: ['limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'service_revenue_per_hour_registry_pipeline',
        args: ['tenant_id', limit],
        async run(admin, tenantId) {
          const servicesSummary = await fetchRows<{
            service_id: string;
            bookings?: number | string | null;
            revenue?: number | string | null;
          }>(
            admin
              .from('service_performance_summary')
              .select('service_id, bookings, revenue')
              .eq('tenant_id', tenantId),
          );

          const serviceIds = servicesSummary.map((row) => row.service_id);
          const services = serviceIds.length
            ? await fetchRows<{ id: string; name?: string | null; duration_minutes?: number | string | null }>(
                admin
                  .from('services')
                  .select('id, name, duration_minutes')
                  .eq('tenant_id', tenantId)
                  .in('id', serviceIds),
              )
            : [];
          const byService = new Map(services.map((service) => [service.id, service]));

          const rows = createLimitRows(
            servicesSummary
              .map((row) => {
                const service = byService.get(row.service_id);
                const bookings = numberValue(row.bookings);
                const durationMinutes = numberValue(service?.duration_minutes);
                const totalHours = bookings > 0 && durationMinutes > 0
                  ? (bookings * durationMinutes) / 60
                  : 0;
                const revenue = numberValue(row.revenue);
                return {
                  service_id: row.service_id,
                  service_name: service?.name ?? 'Unnamed service',
                  bookings,
                  revenue,
                  duration_minutes: durationMinutes,
                  revenue_per_hour: totalHours > 0 ? revenue / totalHours : 0,
                };
              })
              .sort((a, b) => b.revenue_per_hour - a.revenue_per_hour || b.revenue - a.revenue),
            limit,
          );

          return {
            summary: { total_services_ranked: rows.length },
            rows,
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildStaffRevenueMetric(): Metric {
  return {
    key: 'staff_revenue',
    title: 'Staff revenue',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: ['staff'],
    allowedFilters: ['limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'staff_revenue_registry_pipeline',
        args: ['tenant_id', limit],
        async run(admin, tenantId) {
          const summary = await fetchRows<{
            staff_id: string;
            bookings?: number | string | null;
            estimated_revenue?: number | string | null;
            completion_rate?: number | string | null;
          }>(
            admin
              .from('staff_performance_summary')
              .select('staff_id, bookings, estimated_revenue, completion_rate')
              .eq('tenant_id', tenantId),
          );

          const staffIds = summary.map((row) => row.staff_id);
          const staff = staffIds.length
            ? await fetchRows<{ id: string; name?: string | null; phone?: string | null }>(
                admin
                  .from('tenant_users')
                  .select('id, name, phone')
                  .eq('tenant_id', tenantId)
                  .in('id', staffIds),
              )
            : [];
          const staffNames = new Map(staff.map((member) => [member.id, member.name ?? member.phone ?? 'Unknown staff']));

          const rows = createLimitRows(
            summary
              .map((row) => ({
                staff_id: row.staff_id,
                staff_name: staffNames.get(row.staff_id) ?? 'Unknown staff',
                bookings: numberValue(row.bookings),
                revenue: numberValue(row.estimated_revenue),
                completion_rate: numberValue(row.completion_rate),
              }))
              .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings),
            limit,
          );

          return {
            summary: { total_staff_ranked: rows.length },
            rows,
            period: null,
            limitations: [],
          };
        },
      };
    },
  };
}

function buildStaffDiscountsMetric(): Metric {
  return {
    key: 'staff_discounts',
    title: 'Staff discounts',
    requiredPermission: 'VIEW_REVENUE',
    allowedDimensions: ['staff'],
    allowedFilters: ['period_start', 'period_end', 'limit'],
    allowedAggregations: ['rank'],
    build(params) {
      const filters = getFilters(params);
      const period = getPeriodFilters(filters);
      const limit = Math.max(1, Math.min(25, Number(filters.limit ?? 10)));

      return {
        sql: 'staff_discounts_registry_pipeline',
        args: ['tenant_id', period.periodStart, period.periodEnd, limit],
        async run(admin, tenantId) {
          let reservationsQuery = admin
            .from('reservations')
            .select('tenant_staff_id, staff_id, discount_cents')
            .eq('tenant_id', tenantId)
            .not('discount_cents', 'is', null);
          reservationsQuery = applyCreatedAtRange(reservationsQuery, period, 'completed_at');

          const reservations = await fetchRows<{
            tenant_staff_id?: string | null;
            staff_id?: string | null;
            discount_cents?: number | string | null;
          }>(reservationsQuery);

          const staffIds = [...new Set(
            reservations
              .map((row) => row.tenant_staff_id)
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          )];

          const staff = staffIds.length
            ? await fetchRows<{ id: string; name?: string | null; phone?: string | null }>(
                admin
                  .from('tenant_users')
                  .select('id, name, phone')
                  .eq('tenant_id', tenantId)
                  .in('id', staffIds),
              )
            : [];
          const staffNames = new Map(staff.map((member) => [member.id, member.name ?? member.phone ?? 'Unknown staff']));
          const aggregates = new Map<string, { discount_total: number; discounted_reservations: number }>();

          for (const reservation of reservations) {
            const key = reservation.tenant_staff_id ?? 'unassigned';
            const current = aggregates.get(key) ?? { discount_total: 0, discounted_reservations: 0 };
            current.discount_total += nairaFromCents(reservation.discount_cents);
            current.discounted_reservations += 1;
            aggregates.set(key, current);
          }

          const rows = createLimitRows(
            [...aggregates.entries()]
              .map(([staffId, aggregate]) => ({
                staff_id: staffId === 'unassigned' ? null : staffId,
                staff_name: staffId === 'unassigned' ? 'Unassigned' : (staffNames.get(staffId) ?? 'Unknown staff'),
                discount_total: aggregate.discount_total,
                discounted_reservations: aggregate.discounted_reservations,
              }))
              .sort((a, b) => b.discount_total - a.discount_total || b.discounted_reservations - a.discounted_reservations),
            limit,
          );

          return {
            summary: { total_staff_ranked: rows.length },
            rows,
            period: { period_start: period.periodStart, period_end: period.periodEnd },
            limitations: [],
          };
        },
      };
    },
  };
}

export const METRICS = createMetricRegistry([
  buildRevenueTotalMetric(),
  buildRevenueByDayMetric(),
  buildOutstandingTotalMetric(),
  buildTopProductsMetric(),
  buildDeadStockMetric(),
  buildLowStockMetric(),
  buildTopCustomersMetric(),
  buildLapsedCustomersMetric(),
  buildTopServicesMetric(),
  buildServiceRevenuePerHourMetric(),
  buildStaffRevenueMetric(),
  buildStaffDiscountsMetric(),
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
