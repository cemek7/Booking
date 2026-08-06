function numberString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return numberString(Number(value));
  }
  return null;
}

function naira(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '₦0';
  }
  return `₦${Math.round(amount).toLocaleString()}`;
}

function listNames(value: unknown) {
  if (!Array.isArray(value)) {
    return '';
  }

  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);

  return items.join(', ');
}

export interface RecommendationExplanation {
  title: string;
  reason: string;
  recommendedAction: string;
}

export function explainRecommendation(type: string, basis: Record<string, unknown>): RecommendationExplanation {
  switch (type) {
    case 'likely_stockout': {
      const product = String(basis.product_name ?? 'this product');
      const currentStock = numberString(basis.current_stock) ?? '0';
      const dailyUsage = numberString(basis.avg_daily_usage) ?? '0';
      const daysLeft = numberString(basis.days_left) ?? '0';
      return {
        title: `Reorder ${product} soon`,
        reason: `${product} has ${currentStock} units left, is moving about ${dailyUsage} units per day, and only has ${daysLeft} days of stock left.`,
        recommendedAction: `Record a purchase order now so ${product} does not stock out in ${daysLeft} days.`,
      };
    }
    case 'reorder_qty': {
      const product = String(basis.product_name ?? 'this product');
      const currentStock = numberString(basis.current_stock) ?? '0';
      const reorderQty = numberString(basis.suggested_reorder_quantity) ?? '0';
      const threshold = numberString(basis.threshold) ?? '0';
      return {
        title: `Top up ${product}`,
        reason: `${product} is down to ${currentStock} units and the suggested reorder quantity is ${reorderQty} units with a safety threshold of ${threshold}.`,
        recommendedAction: `Record a purchase for ${reorderQty} units of ${product} to rebuild buffer stock.`,
      };
    }
    case 'overstock': {
      const product = String(basis.product_name ?? 'this product');
      const currentStock = numberString(basis.current_stock) ?? '0';
      const daysLeft = numberString(basis.days_left) ?? '0';
      return {
        title: `Reduce exposure on ${product}`,
        reason: `${product} has ${currentStock} units on hand, which is roughly ${daysLeft} days of stock at the current pace.`,
        recommendedAction: `Review pricing, promotion, or purchase cadence for ${product} before more cash stays tied up.`,
      };
    }
    case 'dead_stock': {
      const product = String(basis.product_name ?? 'this product');
      const stockQty = numberString(basis.stock_quantity ?? basis.stock) ?? '0';
      const stockValue = naira(basis.stock_value ?? 0);
      return {
        title: `Move dead stock: ${product}`,
        reason: `${product} still has ${stockQty} units in stock with about ${stockValue} tied up and no recent sales signal.`,
        recommendedAction: `Feature ${product} in a catalog push or bundle so the tied-up ${stockValue} starts converting.`,
      };
    }
    case 'repeat_purchase_due': {
      const customer = String(basis.customer_name ?? 'this customer');
      const daysSinceVisit = numberString(basis.days_since_visit) ?? '0';
      const repeatInterval = numberString(basis.repeat_interval_days) ?? '0';
      return {
        title: `Follow up with ${customer}`,
        reason: `${customer} is ${daysSinceVisit} days from their last visit against a repeat cycle of ${repeatInterval} days.`,
        recommendedAction: `Send a rebooking or repeat-purchase follow-up to ${customer} now.`,
      };
    }
    case 'reactivation': {
      const customer = String(basis.customer_name ?? 'this customer');
      const daysSinceVisit = numberString(basis.days_since_visit) ?? '0';
      const lifetimeValue = naira(basis.lifetime_value ?? 0);
      return {
        title: `Reactivate ${customer}`,
        reason: `${customer} has been inactive for ${daysSinceVisit} days and has already generated about ${lifetimeValue} in value.`,
        recommendedAction: `Send a comeback offer or personal check-in to win ${customer} back.`,
      };
    }
    case 'outstanding_reminder': {
      const customer = String(basis.customer_name ?? 'this customer');
      const balance = naira(basis.outstanding_balance ?? 0);
      return {
        title: `Collect ${balance} from ${customer}`,
        reason: `${customer} still has an outstanding balance of ${balance}.`,
        recommendedAction: `Send a payment reminder and record the settlement once ${customer} pays the ${balance}.`,
      };
    }
    case 'churn_risk': {
      const customer = String(basis.customer_name ?? 'this customer');
      const daysSinceVisit = numberString(basis.days_since_visit) ?? '0';
      const riskScore = String(basis.risk_score ?? 'high');
      const lifetimeValue = naira(basis.lifetime_value ?? 0);
      return {
        title: `Protect ${customer} from churn`,
        reason: `${customer} is marked ${riskScore} risk, has been away for ${daysSinceVisit} days, and represents about ${lifetimeValue} in lifetime value.`,
        recommendedAction: `Run a retention follow-up for ${customer} before the churn risk hardens further.`,
      };
    }
    case 'underbooked_slot': {
      const service = String(basis.service_name ?? 'this service');
      const date = String(basis.date ?? 'the next open day');
      const slots = numberString(basis.available_slots) ?? '0';
      const bookings = numberString(basis.baseline_bookings) ?? '0';
      return {
        title: `Promote ${service} on ${date}`,
        reason: `${service} still has ${slots} open slots on ${date} while recent completed demand is only ${bookings} bookings.`,
        recommendedAction: `Push a targeted offer for ${service} on ${date} to fill the ${slots} open slots.`,
      };
    }
    case 'overbooked_staff': {
      const staff = String(basis.staff_name ?? 'this staff member');
      const openSlots = numberString(basis.remaining_slots) ?? '0';
      const bookings = numberString(basis.completed_bookings) ?? '0';
      return {
        title: `Protect ${staff}'s schedule`,
        reason: `${staff} only has ${openSlots} upcoming slots left while handling about ${bookings} completed bookings in the current run-rate.`,
        recommendedAction: `Shift future demand away from ${staff} or open more capacity before service quality slips.`,
      };
    }
    case 'poor_margin_service': {
      const service = String(basis.service_name ?? 'this service');
      const avgRevenue = naira(basis.avg_revenue_per_booking ?? 0);
      const avgMaterialCost = naira(basis.avg_material_cost ?? 0);
      const marginPercent = numberString(basis.margin_percent) ?? '0';
      return {
        title: `Fix margin on ${service}`,
        reason: `${service} averages ${avgRevenue} per booking against about ${avgMaterialCost} in material cost, leaving only ${marginPercent}% gross margin.`,
        recommendedAction: `Review pricing, recipe usage, or supplier cost on ${service} to improve that ${marginPercent}% margin.`,
      };
    }
    case 'bundle': {
      const base = String(basis.base_product_name ?? 'this product');
      const companions = listNames(basis.companion_products);
      const bundleValue = naira(basis.bundle_value ?? 0);
      return {
        title: `Bundle ${base} with companion items`,
        reason: `${base} is commonly paired with ${companions || 'related items'}, creating about ${bundleValue} in combined catalog value.`,
        recommendedAction: `Create a bundle around ${base} and ${companions || 'its companion items'} to lift basket size.`,
      };
    }
    case 'upsell': {
      const base = String(basis.base_product_name ?? 'this product');
      const suggested = String(basis.suggested_product_name ?? 'the premium option');
      const priceDelta = naira(basis.price_delta ?? 0);
      return {
        title: `Upsell ${base} to ${suggested}`,
        reason: `${suggested} sits ${priceDelta} above ${base} and is already linked as a frequent upgrade path.`,
        recommendedAction: `Offer ${suggested} whenever customers ask for ${base} and position the ${priceDelta} premium clearly.`,
      };
    }
    case 'cross_sell': {
      const base = String(basis.base_product_name ?? 'this product');
      const suggested = String(basis.suggested_product_name ?? 'a companion product');
      const combinedValue = naira(basis.combined_value ?? 0);
      return {
        title: `Cross-sell ${suggested} with ${base}`,
        reason: `${base} is frequently bought with ${suggested}, and together they represent about ${combinedValue} in basket value.`,
        recommendedAction: `Add ${suggested} as a companion suggestion whenever ${base} is being discussed or sold.`,
      };
    }
    default:
      return {
        title: 'Review recommendation',
        reason: 'Booka found a grounded signal worth reviewing.',
        recommendedAction: 'Review the recommendation details and decide whether to act now or snooze it.',
      };
  }
}
