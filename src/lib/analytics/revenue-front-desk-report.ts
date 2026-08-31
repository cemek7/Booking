export interface RevenueFrontDeskReport {
  period: { start: string; end: string };
  currency: string;
  funnel: {
    enquiries: number;
    qualified: number;
    bookings: number;
    sales: number;
    deposits_or_payments: number;
    followups_sent: number;
    recovered_opportunities: number;
    escalations: number;
  };
  revenue: {
    processed_cents: number;
    influenced_cents: number;
    recovered_cents: number;
  };
  handling: { automated: number; human: number; unresolved: number };
  completeness: {
    unverified_attributions: number;
    missing_amount_events: number;
    offline_confirmation_required: boolean;
  };
}

export interface RevenueFrontDeskReportInput {
  tenantId: string;
  start: string;
  end: string;
  currency?: string;
}

type ReportRow = Record<string, unknown>;
type QueryResult = { data: ReportRow[] | null; error: { message?: string } | null };

interface ReportQuery extends PromiseLike<QueryResult> {
  select(columns: string): ReportQuery;
  eq(column: string, value: unknown): ReportQuery;
  gte(column: string, value: unknown): ReportQuery;
  lt(column: string, value: unknown): ReportQuery;
}

interface RevenueReportClient {
  from(table: string): unknown;
}

const VERIFIED_STATUSES = new Set(['merchant_confirmed', 'system_verified']);
const AUTOMATED_ROLES = new Set(['assistant', 'ai', 'booka', 'system']);
const HUMAN_ROLES = new Set(['agent', 'human', 'manager', 'owner', 'staff']);

function handlingKey(row: ReportRow, index: number): string {
  return typeof row.correlation_id === 'string' && row.correlation_id
    ? `correlation:${row.correlation_id}`
    : `row:${typeof row.id === 'string' ? row.id : index}`;
}

function toSafeCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0
    ? amount
    : null;
}

function normalizedCurrency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
}

async function loadRows(
  client: RevenueReportClient,
  table: string,
  columns: string,
  input: RevenueFrontDeskReportInput,
): Promise<ReportRow[]> {
  const query = client.from(table) as ReportQuery;
  const { data, error } = await query
    .select(columns)
    .eq('tenant_id', input.tenantId)
    .gte('created_at', input.start)
    .lt('created_at', input.end);

  if (error) {
    throw new Error(`Failed to load ${table}: ${error.message ?? 'unknown database error'}`);
  }
  return data ?? [];
}

export async function buildRevenueFrontDeskReport(
  client: RevenueReportClient,
  input: RevenueFrontDeskReportInput,
): Promise<RevenueFrontDeskReport> {
  const [eventRows, attributionRows] = await Promise.all([
    loadRows(
      client,
      'ai_front_desk_events',
      'id,event_type,actor_role,correlation_id,created_at',
      input,
    ),
    loadRows(
      client,
      'sias_outcome_attributions',
      'id,attribution_type,verification_status,amount_cents,currency,created_at',
      input,
    ),
  ]);

  const countEvents = (...types: string[]) => {
    const accepted = new Set(types);
    const outcomeKeys = new Set<string>();
    eventRows.forEach((row, index) => {
      if (!accepted.has(String(row.event_type))) return;
      const correlationId = typeof row.correlation_id === 'string' && row.correlation_id
        ? row.correlation_id
        : null;
      const rowId = typeof row.id === 'string' && row.id ? row.id : String(index);
      outcomeKeys.add(correlationId ? `correlation:${correlationId}` : `row:${rowId}`);
    });
    return outcomeKeys.size;
  };

  const handlingGroups = new Map<string, { automated: boolean; human: boolean; handoff: boolean }>();
  eventRows.forEach((row, index) => {
    const key = handlingKey(row, index);
    const group = handlingGroups.get(key) ?? { automated: false, human: false, handoff: false };
    const role = typeof row.actor_role === 'string' ? row.actor_role.toLowerCase() : '';
    group.automated ||= AUTOMATED_ROLES.has(role);
    group.human ||= HUMAN_ROLES.has(role);
    group.handoff ||= row.event_type === 'handoff_requested';
    handlingGroups.set(key, group);
  });

  const explicitCurrencies = new Set(
    attributionRows
      .filter((row) => toSafeCents(row.amount_cents) !== null)
      .map((row) => normalizedCurrency(row.currency))
      .filter((currency): currency is string => currency !== null),
  );
  if (explicitCurrencies.size > 1) {
    throw new Error('Revenue report contains multiple currencies and cannot combine unlike money');
  }

  const fallbackCurrency = input.currency?.toUpperCase() ?? 'NGN';
  if (!/^[A-Z]{3}$/.test(fallbackCurrency)) {
    throw new Error('Revenue report currency must be a three-letter uppercase ISO code');
  }
  const currency = explicitCurrencies.values().next().value ?? fallbackCurrency;

  const revenue = {
    processed_cents: 0,
    influenced_cents: 0,
    recovered_cents: 0,
  };
  for (const row of attributionRows) {
    if (!VERIFIED_STATUSES.has(String(row.verification_status))) continue;
    const amount = toSafeCents(row.amount_cents);
    if (amount === null || normalizedCurrency(row.currency) !== currency) continue;

    if (row.attribution_type === 'processed') revenue.processed_cents += amount;
    if (row.attribution_type === 'influenced') revenue.influenced_cents += amount;
    if (row.attribution_type === 'recovered') revenue.recovered_cents += amount;
  }

  const unverifiedAttributions = attributionRows.filter(
    (row) => row.verification_status === 'unverified',
  ).length;
  const missingAmountEvents = attributionRows.filter((row) => (
    row.attribution_type !== null
    && row.attribution_type !== undefined
    && row.verification_status !== 'rejected'
    && (toSafeCents(row.amount_cents) === null || normalizedCurrency(row.currency) === null)
  )).length;

  let automated = 0;
  let human = 0;
  let unresolved = 0;
  for (const group of handlingGroups.values()) {
    if (group.handoff || group.human) human += 1;
    else if (group.automated) automated += 1;
    else unresolved += 1;
  }

  return {
    period: { start: input.start, end: input.end },
    currency,
    funnel: {
      enquiries: countEvents('inquiry_received'),
      qualified: countEvents('lead_created', 'lead_qualified'),
      bookings: countEvents('booking_created'),
      sales: countEvents('upsell_accepted', 'cross_sell_accepted'),
      deposits_or_payments: countEvents('payment_completed'),
      followups_sent: countEvents('follow_up_sent'),
      recovered_opportunities: attributionRows.filter((row) => (
        row.attribution_type === 'recovered'
        && VERIFIED_STATUSES.has(String(row.verification_status))
      )).length,
      escalations: countEvents('handoff_requested'),
    },
    revenue,
    handling: { automated, human, unresolved },
    completeness: {
      unverified_attributions: unverifiedAttributions,
      missing_amount_events: missingAmountEvents,
      offline_confirmation_required: unverifiedAttributions > 0 || missingAmountEvents > 0,
    },
  };
}
