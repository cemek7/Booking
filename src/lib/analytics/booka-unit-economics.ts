export interface BookaUnitEconomicsInput {
  start: string;
  end: string;
  tenantId?: string;
}

export interface BookaUnitEconomicsRow {
  tenant_id: string;
  recognized_revenue_credits: number;
  provider_cost_credits: number;
  costs_by_type: {
    llm: number;
    whatsapp: number;
    server: number;
    payment: number;
    manual_adjustment: number;
  };
  gross_contribution_credits: number;
  gross_margin_percent: number | null;
  conversation_volume: number;
  verified_outcomes: number;
  cost_per_verified_outcome_credits: number | null;
  cost_capture_complete: boolean;
}

export interface BookaUnitEconomicsReport {
  period: { start: string; end: string };
  tenants: BookaUnitEconomicsRow[];
  totals: Omit<BookaUnitEconomicsRow, 'tenant_id'>;
}

type LedgerRow = Record<string, unknown>;
type QueryResult = { data: LedgerRow[] | null; error: { message?: string } | null };

interface UnitEconomicsQuery extends PromiseLike<QueryResult> {
  select(columns: string): UnitEconomicsQuery;
  eq(column: string, value: unknown): UnitEconomicsQuery;
  gte(column: string, value: unknown): UnitEconomicsQuery;
  lt(column: string, value: unknown): UnitEconomicsQuery;
}

interface UnitEconomicsClient {
  from(table: string): unknown;
}

const RECOGNIZED_REVENUE_TYPES = new Set([
  'usage_charge',
  'subscription_charge',
  'overage_charge',
  'refund',
  'manual_adjustment',
]);
const VERIFIED_STATUSES = new Set(['merchant_confirmed', 'system_verified']);
const COST_TYPES = ['llm', 'whatsapp', 'server', 'payment', 'manual_adjustment'] as const;

function numeric(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyCosts(): BookaUnitEconomicsRow['costs_by_type'] {
  return { llm: 0, whatsapp: 0, server: 0, payment: 0, manual_adjustment: 0 };
}

async function loadRows(
  client: UnitEconomicsClient,
  table: string,
  columns: string,
  input: BookaUnitEconomicsInput,
): Promise<LedgerRow[]> {
  let query = (client.from(table) as UnitEconomicsQuery).select(columns);
  if (input.tenantId) query = query.eq('tenant_id', input.tenantId);
  const { data, error } = await query
    .gte('created_at', input.start)
    .lt('created_at', input.end);

  if (error) {
    throw new Error(`Failed to load ${table}: ${error.message ?? 'unknown database error'}`);
  }
  return data ?? [];
}

function calculateRatios(
  recognizedRevenue: number,
  providerCost: number,
  verifiedOutcomes: number,
) {
  const grossContribution = recognizedRevenue - providerCost;
  return {
    gross_contribution_credits: grossContribution,
    gross_margin_percent: recognizedRevenue === 0
      ? null
      : (grossContribution / recognizedRevenue) * 100,
    cost_per_verified_outcome_credits: verifiedOutcomes === 0
      ? null
      : providerCost / verifiedOutcomes,
  };
}

export async function buildBookaUnitEconomics(
  client: UnitEconomicsClient,
  input: BookaUnitEconomicsInput,
): Promise<BookaUnitEconomicsReport> {
  const [revenueRows, costRows, eventRows, attributionRows] = await Promise.all([
    loadRows(client, 'tenant_revenue_ledger', 'tenant_id,revenue_type,amount_credits,created_at', input),
    loadRows(client, 'tenant_cost_ledger', 'tenant_id,cost_type,actual_cost_credits,created_at', input),
    loadRows(client, 'ai_front_desk_events', 'id,tenant_id,correlation_id,created_at', input),
    loadRows(
      client,
      'sias_outcome_attributions',
      'id,tenant_id,attribution_type,verification_status,created_at',
      input,
    ),
  ]);

  const tenantIds = new Set<string>();
  for (const row of [...revenueRows, ...costRows, ...eventRows, ...attributionRows]) {
    if (typeof row.tenant_id === 'string' && row.tenant_id) tenantIds.add(row.tenant_id);
  }
  if (input.tenantId) tenantIds.add(input.tenantId);

  const tenants = [...tenantIds].sort().map((tenantId): BookaUnitEconomicsRow => {
    const tenantRevenue = revenueRows.filter((row) => row.tenant_id === tenantId);
    const tenantCosts = costRows.filter((row) => row.tenant_id === tenantId);
    const tenantProviderCosts = tenantCosts.filter((row) => row.cost_type !== 'manual_adjustment');
    const tenantEvents = eventRows.filter((row) => row.tenant_id === tenantId);
    const tenantAttributions = attributionRows.filter((row) => row.tenant_id === tenantId);

    const recognizedRevenue = tenantRevenue.reduce((sum, row) => (
      RECOGNIZED_REVENUE_TYPES.has(String(row.revenue_type))
        ? sum + numeric(row.amount_credits)
        : sum
    ), 0);
    const costsByType = emptyCosts();
    for (const row of tenantCosts) {
      const costType = String(row.cost_type) as (typeof COST_TYPES)[number];
      if (COST_TYPES.includes(costType)) costsByType[costType] += numeric(row.actual_cost_credits);
    }
    const providerCost = Object.values(costsByType).reduce((sum, value) => sum + value, 0);

    const conversationKeys = new Set<string>();
    tenantEvents.forEach((row, index) => {
      const correlationId = typeof row.correlation_id === 'string' && row.correlation_id
        ? row.correlation_id
        : null;
      const rowId = typeof row.id === 'string' && row.id ? row.id : String(index);
      conversationKeys.add(correlationId ? `correlation:${correlationId}` : `row:${rowId}`);
    });

    const verifiedOutcomes = tenantAttributions.filter((row) => (
      typeof row.attribution_type === 'string'
      && VERIFIED_STATUSES.has(String(row.verification_status))
    )).length;

    return {
      tenant_id: tenantId,
      recognized_revenue_credits: recognizedRevenue,
      provider_cost_credits: providerCost,
      costs_by_type: costsByType,
      ...calculateRatios(recognizedRevenue, providerCost, verifiedOutcomes),
      conversation_volume: conversationKeys.size,
      verified_outcomes: verifiedOutcomes,
      cost_capture_complete: !(tenantEvents.length > 0 && tenantProviderCosts.length === 0),
    };
  });

  const totalsBase = tenants.reduce((totals, row) => {
    totals.recognizedRevenue += row.recognized_revenue_credits;
    totals.providerCost += row.provider_cost_credits;
    totals.conversations += row.conversation_volume;
    totals.verifiedOutcomes += row.verified_outcomes;
    for (const costType of COST_TYPES) totals.costs[costType] += row.costs_by_type[costType];
    return totals;
  }, {
    recognizedRevenue: 0,
    providerCost: 0,
    conversations: 0,
    verifiedOutcomes: 0,
    costs: emptyCosts(),
  });

  return {
    period: { start: input.start, end: input.end },
    tenants,
    totals: {
      recognized_revenue_credits: totalsBase.recognizedRevenue,
      provider_cost_credits: totalsBase.providerCost,
      costs_by_type: totalsBase.costs,
      ...calculateRatios(
        totalsBase.recognizedRevenue,
        totalsBase.providerCost,
        totalsBase.verifiedOutcomes,
      ),
      conversation_volume: totalsBase.conversations,
      verified_outcomes: totalsBase.verifiedOutcomes,
      cost_capture_complete: tenants.every((tenant) => tenant.cost_capture_complete),
    },
  };
}
