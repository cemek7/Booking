import type { SupabaseClient } from '@supabase/supabase-js';
import { runMetric } from '@/lib/analytics/metrics/registry';
import { explainRecommendation } from '@/lib/recommendations/explain';
import {
  DEFAULT_RECOMMENDATION_THRESHOLDS,
  deriveRecommendationThresholds,
  type RecommendationThresholds,
} from '@/lib/recommendations/outcomes';

export interface RecommendationDraft {
  type: string;
  entityType: string;
  entityId: string | null;
  title: string;
  reason: string;
  recommendedAction: string;
  basis: Record<string, unknown>;
  confidence: number;
  estimatedImpact?: Record<string, unknown>;
}

interface RecommendationSignal {
  type: string;
  entityType: string;
  entityId: string | null;
  basis: Record<string, unknown>;
  confidence: number;
  estimatedImpact?: Record<string, unknown>;
}

export interface Generator {
  type: string;
  generate(admin: SupabaseClient, tenantId: string, thresholds: RecommendationThresholds): Promise<RecommendationDraft[]>;
}

function localDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function daysBetween(dateIso: string | null | undefined, now = new Date()) {
  if (!dateIso) return null;
  const ts = Date.parse(dateIso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((now.getTime() - ts) / (24 * 60 * 60 * 1000)));
}

async function generateInventoryRecommendations(
  admin: SupabaseClient,
  tenantId: string,
  thresholds: RecommendationThresholds,
): Promise<RecommendationDraft[]> {
  const [{ data: products, error: productsError }, { data: movements, error: movementError }] = await Promise.all([
    admin
      .from('products')
      .select('id, name, stock_quantity, low_stock_threshold, price_cents, track_inventory, is_active')
      .eq('tenant_id', tenantId)
      .eq('track_inventory', true)
      .eq('is_active', true),
    admin
      .from('inventory_movements')
      .select('product_id, quantity_change, created_at')
      .eq('tenant_id', tenantId),
  ]);

  if (productsError) throw productsError;
  if (movementError) throw movementError;

  const byProduct = new Map<string, { usage: number; recentDays: Set<string> }>();
  for (const movement of movements ?? []) {
    const productId = String(movement.product_id ?? '');
    if (!productId) continue;
    const change = Number(movement.quantity_change ?? 0);
    if (change >= 0) continue;
    const entry = byProduct.get(productId) ?? { usage: 0, recentDays: new Set<string>() };
    entry.usage += Math.abs(change);
    if (typeof movement.created_at === 'string') entry.recentDays.add(movement.created_at.slice(0, 10));
    byProduct.set(productId, entry);
  }

  const drafts: RecommendationSignal[] = [];
  for (const product of products ?? []) {
    const productId = String(product.id ?? '');
    const productName = String(product.name ?? 'Unnamed product');
    const currentStock = Number(product.stock_quantity ?? 0);
    const threshold = Number(product.low_stock_threshold ?? 0);
    const usage = byProduct.get(productId);
    const activeDays = usage?.recentDays.size ?? 0;
    const avgDailyUsage = activeDays > 0 ? usage!.usage / activeDays : 0;
    const daysLeft = avgDailyUsage > 0 ? currentStock / avgDailyUsage : null;

    if (daysLeft !== null && daysLeft <= thresholds.likelyStockoutDays) {
      drafts.push({
        type: 'likely_stockout',
        entityType: 'product',
        entityId: productId,
        basis: {
          product_id: productId,
          product_name: productName,
          avg_daily_usage: Number(avgDailyUsage.toFixed(2)),
          current_stock: currentStock,
          days_left: Number(daysLeft.toFixed(1)),
        },
        confidence: 0.9,
        estimatedImpact: typeof product.price_cents === 'number'
          ? { protected_stock_value: Math.round((currentStock * product.price_cents) / 100) }
          : undefined,
      });

      drafts.push({
        type: 'reorder_qty',
        entityType: 'product',
        entityId: productId,
        basis: {
          product_id: productId,
          product_name: productName,
          avg_daily_usage: Number(avgDailyUsage.toFixed(2)),
          current_stock: currentStock,
          suggested_reorder_quantity: Math.ceil(avgDailyUsage * 30 + threshold),
          threshold,
        },
        confidence: 0.85,
      });
    } else if (daysLeft !== null && daysLeft >= 90 && currentStock > threshold) {
      drafts.push({
        type: 'overstock',
        entityType: 'product',
        entityId: productId,
        basis: {
          product_id: productId,
          product_name: productName,
          avg_daily_usage: Number(avgDailyUsage.toFixed(2)),
          current_stock: currentStock,
          days_left: Number(daysLeft.toFixed(1)),
        },
        confidence: 0.72,
      });
    }
  }

  const deadStock = await runMetric(admin, tenantId, 'dead_stock', {
    dimensions: ['product'],
    filters: { period_start: `${localDateString(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000))}T00:00:00`, limit: 10 },
    aggregation: 'rank',
  });

  for (const row of deadStock.result.rows) {
    drafts.push({
      type: 'dead_stock',
      entityType: 'product',
      entityId: String(row.product_id ?? ''),
      basis: { ...row },
      confidence: 0.75,
      estimatedImpact: Number(row.stock_value ?? 0) > 0 ? { tied_up_value: Number(row.stock_value) } : undefined,
    });
  }

  return drafts.map(finalizeDraft);
}

async function generateCustomerRecommendations(
  admin: SupabaseClient,
  tenantId: string,
  thresholds: RecommendationThresholds,
): Promise<RecommendationDraft[]> {
  const { data: profiles, error } = await admin
    .from('customer_profile_summary')
    .select('customer_id, customer_name, lifetime_bookings, lifetime_value_cents, last_visit, repeat_interval_days, days_since_visit, outstanding_balance_cents, risk_score')
    .eq('tenant_id', tenantId);

  if (error) throw error;

  const drafts: RecommendationSignal[] = [];
  for (const profile of profiles ?? []) {
    const customerId = String(profile.customer_id ?? '');
    if (!customerId) continue;
    const customerName = String(profile.customer_name ?? 'Customer');
    const daysSinceVisit = Number(profile.days_since_visit ?? daysBetween(typeof profile.last_visit === 'string' ? profile.last_visit : null) ?? 0);
    const repeatIntervalDays = Number(profile.repeat_interval_days ?? 0);
    const lifetimeValue = Number(profile.lifetime_value_cents ?? 0) / 100;
    const outstanding = Number(profile.outstanding_balance_cents ?? 0) / 100;

    if (repeatIntervalDays > 0 && daysSinceVisit >= repeatIntervalDays) {
      drafts.push({
        type: 'repeat_purchase_due',
        entityType: 'customer',
        entityId: customerId,
        basis: {
          customer_id: customerId,
          customer_name: customerName,
          days_since_visit: daysSinceVisit,
          repeat_interval_days: repeatIntervalDays,
        },
        confidence: 0.8,
      });
    }

    if (daysSinceVisit >= thresholds.reactivationDays) {
      drafts.push({
        type: 'reactivation',
        entityType: 'customer',
        entityId: customerId,
        basis: {
          customer_id: customerId,
          customer_name: customerName,
          days_since_visit: daysSinceVisit,
          lifetime_value: lifetimeValue,
        },
        confidence: daysSinceVisit >= 90 ? 0.9 : 0.7,
      });
    }

    if (outstanding > 0) {
      drafts.push({
        type: 'outstanding_reminder',
        entityType: 'customer',
        entityId: customerId,
        basis: {
          customer_id: customerId,
          customer_name: customerName,
          outstanding_balance: outstanding,
        },
        confidence: 0.85,
        estimatedImpact: { recoverable_value: outstanding },
      });
    }

    const riskScore = String(profile.risk_score ?? '').toLowerCase();
    if ((riskScore === 'high' || riskScore === 'critical') && lifetimeValue > 0 && daysSinceVisit >= thresholds.churnRiskMinDays) {
      drafts.push({
        type: 'churn_risk',
        entityType: 'customer',
        entityId: customerId,
        basis: {
          customer_id: customerId,
          customer_name: customerName,
          days_since_visit: daysSinceVisit,
          lifetime_value: lifetimeValue,
          risk_score: riskScore,
        },
        confidence: riskScore === 'critical' ? 0.92 : 0.81,
      });
    }
  }

  return drafts.map(finalizeDraft);
}

async function generateServiceRecommendations(
  admin: SupabaseClient,
  tenantId: string,
  thresholds: RecommendationThresholds,
): Promise<RecommendationDraft[]> {
  const today = localDateString();
  const horizonEnd = localDateString(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  const [
    { data: summaries, error: summariesError },
    { data: services, error: servicesError },
    { data: consumption, error: consumptionError },
    { data: products, error: productsError },
    { data: availability, error: availabilityError },
    { data: staffSummaries, error: staffError },
    { data: staffRows, error: staffRowsError },
  ] = await Promise.all([
    admin
      .from('service_performance_summary')
      .select('service_id, bookings, revenue, completion_rate')
      .eq('tenant_id', tenantId),
    admin
      .from('services')
      .select('id, name, price_cents, price, duration')
      .eq('tenant_id', tenantId),
    admin
      .from('service_consumption_records')
      .select('service_id, reservation_id, product_id, planned_quantity, actual_quantity')
      .eq('tenant_id', tenantId),
    admin
      .from('products')
      .select('id, name, price_cents, cost_price_cents, frequently_bought_together, is_active, upsell_priority')
      .eq('tenant_id', tenantId)
      .eq('is_active', true),
    admin
      .from('availability_snapshot')
      .select('staff_id, service_id, date, available_slots')
      .eq('tenant_id', tenantId)
      .gte('date', today)
      .lt('date', horizonEnd),
    admin
      .from('staff_performance_summary')
      .select('staff_id, bookings, completion_rate, estimated_revenue')
      .eq('tenant_id', tenantId),
    admin
      .from('tenant_users')
      .select('id, name, full_name')
      .eq('tenant_id', tenantId),
  ]);

  if (summariesError) throw summariesError;
  if (servicesError) throw servicesError;
  if (consumptionError) throw consumptionError;
  if (productsError) throw productsError;
  if (availabilityError) throw availabilityError;
  if (staffError) throw staffError;
  if (staffRowsError) throw staffRowsError;

  const serviceMap = new Map((services ?? []).map((row) => {
    const price =
      typeof row.price_cents === 'number'
        ? row.price_cents / 100
        : Number.isFinite(Number(row.price ?? 0))
          ? Number(row.price ?? 0)
          : 0;
    return [String(row.id), { name: String(row.name ?? 'Service'), price, duration: Number(row.duration ?? 60) }];
  }));

  const productMap = new Map((products ?? []).map((row) => [String(row.id), row]));
  const staffNameMap = new Map((staffRows ?? []).map((row) => [
    String(row.id),
    String(row.full_name ?? row.name ?? 'Staff member'),
  ]));

  const consumptionByService = new Map<string, { totalCost: number; reservations: Set<string> }>();
  for (const row of consumption ?? []) {
    const serviceId = String(row.service_id ?? '');
    const productId = String(row.product_id ?? '');
    if (!serviceId || !productId) continue;
    const product = productMap.get(productId);
    if (!product) continue;
    const quantity = Number(row.actual_quantity ?? row.planned_quantity ?? 0);
    const unitCost = Number(product.cost_price_cents ?? 0) / 100;
    const entry = consumptionByService.get(serviceId) ?? { totalCost: 0, reservations: new Set<string>() };
    entry.totalCost += quantity * unitCost;
    if (row.reservation_id) entry.reservations.add(String(row.reservation_id));
    consumptionByService.set(serviceId, entry);
  }

  const drafts: RecommendationSignal[] = [];

  for (const summary of summaries ?? []) {
    const serviceId = String(summary.service_id ?? '');
    const service = serviceMap.get(serviceId);
    if (!service) continue;

    const bookings = Number(summary.bookings ?? 0);
    const revenue = Number(summary.revenue ?? 0);
    const avgRevenuePerBooking = bookings > 0 ? revenue / bookings : service.price;
    const costEntry = consumptionByService.get(serviceId);
    const avgMaterialCost =
      costEntry && costEntry.reservations.size > 0
        ? costEntry.totalCost / costEntry.reservations.size
        : 0;
    const marginPercent =
      avgRevenuePerBooking > 0
        ? ((avgRevenuePerBooking - avgMaterialCost) / avgRevenuePerBooking) * 100
        : 0;

    if (bookings >= 3 && marginPercent > 0 && marginPercent <= thresholds.lowMarginPercent) {
      drafts.push({
        type: 'poor_margin_service',
        entityType: 'service',
        entityId: serviceId,
        basis: {
          service_id: serviceId,
          service_name: service.name,
          bookings,
          avg_revenue_per_booking: Number(avgRevenuePerBooking.toFixed(2)),
          avg_material_cost: Number(avgMaterialCost.toFixed(2)),
          margin_percent: Number(marginPercent.toFixed(1)),
        },
        confidence: 0.82,
        estimatedImpact: {
          monthly_margin_leak: Number(((avgRevenuePerBooking - avgMaterialCost) * bookings).toFixed(2)),
        },
      });
    }
  }

  const availabilityByServiceDate = new Map<string, { serviceId: string; date: string; availableSlots: number }>();
  const availabilityByStaff = new Map<string, { staffId: string; availableSlots: number }>();

  for (const row of availability ?? []) {
    const serviceId = String(row.service_id ?? '');
    const staffId = String(row.staff_id ?? '');
    const date = String(row.date ?? '');
    const slots = Array.isArray(row.available_slots) ? row.available_slots.length : 0;
    if (serviceId && date) {
      const key = `${serviceId}:${date}`;
      const entry = availabilityByServiceDate.get(key) ?? { serviceId, date, availableSlots: 0 };
      entry.availableSlots += slots;
      availabilityByServiceDate.set(key, entry);
    }
    if (staffId) {
      const entry = availabilityByStaff.get(staffId) ?? { staffId, availableSlots: 0 };
      entry.availableSlots += slots;
      availabilityByStaff.set(staffId, entry);
    }
  }

  for (const entry of availabilityByServiceDate.values()) {
    const service = serviceMap.get(entry.serviceId);
    const summary = (summaries ?? []).find((row) => String(row.service_id ?? '') === entry.serviceId);
    const baselineBookings = Number(summary?.bookings ?? 0);
    if (!service || entry.availableSlots < thresholds.underbookedMinSlots || baselineBookings > 5) continue;
    drafts.push({
      type: 'underbooked_slot',
      entityType: 'service',
      entityId: `${entry.serviceId}:${entry.date}`,
      basis: {
        service_id: entry.serviceId,
        service_name: service.name,
        date: entry.date,
        available_slots: entry.availableSlots,
        baseline_bookings: baselineBookings,
      },
      confidence: 0.74,
    });
  }

  for (const summary of staffSummaries ?? []) {
    const staffId = String(summary.staff_id ?? '');
    const remainingSlots = availabilityByStaff.get(staffId)?.availableSlots ?? 0;
    const bookings = Number(summary.bookings ?? 0);
    if (bookings < 10 || remainingSlots > thresholds.overbookedMaxSlots) continue;
    drafts.push({
      type: 'overbooked_staff',
      entityType: 'staff',
      entityId: staffId,
      basis: {
        staff_id: staffId,
        staff_name: staffNameMap.get(staffId) ?? 'Staff member',
        remaining_slots: remainingSlots,
        completed_bookings: bookings,
      },
      confidence: 0.83,
    });
  }

  for (const product of products ?? []) {
    const baseId = String(product.id ?? '');
    const baseName = String(product.name ?? 'Product');
    const basePrice = Number(product.price_cents ?? 0) / 100;
    const relatedIds = Array.isArray(product.frequently_bought_together)
      ? product.frequently_bought_together.map((value) => String(value))
      : [];
    const relatedProducts = relatedIds
      .map((id) => productMap.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (relatedProducts.length >= 2) {
      const companionNames = relatedProducts.slice(0, 2).map((row) => String(row.name ?? 'Product'));
      const bundleValue = basePrice + relatedProducts.slice(0, 2).reduce((sum, row) => sum + Number(row.price_cents ?? 0) / 100, 0);
      drafts.push({
        type: 'bundle',
        entityType: 'product',
        entityId: baseId,
        basis: {
          base_product_id: baseId,
          base_product_name: baseName,
          companion_products: companionNames,
          bundle_value: Number(bundleValue.toFixed(2)),
        },
        confidence: 0.71,
        estimatedImpact: { bundle_value: Number(bundleValue.toFixed(2)) },
      });
    }

    const pricier = relatedProducts
      .filter((row) => Number(row.price_cents ?? 0) > Number(product.price_cents ?? 0))
      .sort((a, b) => Number(b.upsell_priority ?? 0) - Number(a.upsell_priority ?? 0))[0];

    if (pricier) {
      drafts.push({
        type: 'upsell',
        entityType: 'product',
        entityId: baseId,
        basis: {
          base_product_id: baseId,
          base_product_name: baseName,
          suggested_product_id: String(pricier.id ?? ''),
          suggested_product_name: String(pricier.name ?? 'Premium option'),
          base_price: basePrice,
          suggested_price: Number(pricier.price_cents ?? 0) / 100,
          price_delta: Number(((Number(pricier.price_cents ?? 0) - Number(product.price_cents ?? 0)) / 100).toFixed(2)),
        },
        confidence: 0.76,
      });
    }

    const companion = relatedProducts
      .filter((row) => Number(row.price_cents ?? 0) <= Number(product.price_cents ?? 0))
      .sort((a, b) => Number(a.price_cents ?? 0) - Number(b.price_cents ?? 0))[0];

    if (companion) {
      const companionPrice = Number(companion.price_cents ?? 0) / 100;
      drafts.push({
        type: 'cross_sell',
        entityType: 'product',
        entityId: `${baseId}:${String(companion.id ?? '')}`,
        basis: {
          base_product_id: baseId,
          base_product_name: baseName,
          suggested_product_id: String(companion.id ?? ''),
          suggested_product_name: String(companion.name ?? 'Companion item'),
          base_price: basePrice,
          suggested_price: companionPrice,
          combined_value: Number((basePrice + companionPrice).toFixed(2)),
        },
        confidence: 0.73,
        estimatedImpact: { combined_value: Number((basePrice + companionPrice).toFixed(2)) },
      });
    }
  }

  return drafts.map(finalizeDraft);
}

function finalizeDraft(signal: RecommendationSignal): RecommendationDraft {
  const explanation = explainRecommendation(signal.type, signal.basis);
  return {
    type: signal.type,
    entityType: signal.entityType,
    entityId: signal.entityId,
    title: explanation.title,
    reason: explanation.reason,
    recommendedAction: explanation.recommendedAction,
    basis: signal.basis,
    confidence: signal.confidence,
    estimatedImpact: signal.estimatedImpact,
  };
}

export const GENERATORS: Generator[] = [
  {
    type: 'inventory',
    generate: generateInventoryRecommendations,
  },
  {
    type: 'customer',
    generate: generateCustomerRecommendations,
  },
  {
    type: 'service',
    generate: generateServiceRecommendations,
  },
];

export async function runGenerators(admin: SupabaseClient, tenantId: string) {
  const thresholds = await deriveRecommendationThresholds(admin, tenantId).catch(() => DEFAULT_RECOMMENDATION_THRESHOLDS);
  const drafts = (await Promise.all(GENERATORS.map((generator) => generator.generate(admin, tenantId, thresholds)))).flat();
  const inserted: RecommendationDraft[] = [];

  for (const draft of drafts) {
    if (!draft.entityId) continue;

    const { data: existing, error: existingError } = await admin
      .from('business_recommendations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('type', draft.type)
      .eq('entity_type', draft.entityType)
      .eq('entity_id', draft.entityId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing?.id) continue;

    const { error: insertError } = await admin.from('business_recommendations').insert({
      tenant_id: tenantId,
      type: draft.type,
      title: draft.title,
      reason: draft.reason,
      recommended_action: draft.recommendedAction,
      basis: draft.basis,
      estimated_impact: draft.estimatedImpact ?? null,
      confidence: draft.confidence,
      entity_type: draft.entityType,
      entity_id: draft.entityId,
    });

    if (insertError) throw insertError;
    inserted.push(draft);
  }

  return inserted;
}
