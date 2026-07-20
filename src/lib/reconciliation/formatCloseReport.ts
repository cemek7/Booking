interface ReportRunLike {
  business_date: string;
  expected_revenue_cents: number;
  recorded_payments_cents: number;
  approved_outstanding_cents: number;
  revenue_gap_cents: number;
}

interface ReportItemLike {
  item_type: string;
}

function naira(cents: number) {
  return `₦${Math.round(cents / 100).toLocaleString()}`;
}

export function formatCloseReportText(run: ReportRunLike, items: ReportItemLike[]): string {
  const counts = items.reduce<Record<string, number>>((map, item) => {
    map[item.item_type] = (map[item.item_type] ?? 0) + 1;
    return map;
  }, {});

  const labels: Record<string, string> = {
    unpaid_completed_service: 'completed appointments without payments',
    delivered_unpaid_order: 'delivered orders marked unpaid',
    discount_without_reason: 'discounts without a reason',
  };

  const reviewLines = Object.entries(counts).map(
    ([type, count]) => `- ${count} ${labels[type] ?? type}`
  );

  return [
    `Today's Revenue Assurance Report (${run.business_date})`,
    '',
    `Expected revenue: ${naira(run.expected_revenue_cents)}`,
    `Recorded payments: ${naira(run.recorded_payments_cents)}`,
    `Approved outstanding: ${naira(run.approved_outstanding_cents)}`,
    `Unexplained difference: ${naira(run.revenue_gap_cents)}`,
    ...(reviewLines.length ? ['', 'Items requiring review:', ...reviewLines] : []),
  ].join('\n');
}
