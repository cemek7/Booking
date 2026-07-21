import type { SupabaseClient } from '@supabase/supabase-js';
import { runMetric } from '@/lib/analytics/metrics/registry';

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

export interface Generator {
  type: string;
  generate(admin: SupabaseClient, tenantId: string): Promise<RecommendationDraft[]>;
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

async function generateInventoryRecommendations(admin: SupabaseClient, tenantId: string): Promise<RecommendationDraft[]> {
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

  const drafts: RecommendationDraft[] = [];
  for (const product of products ?? []) {
    const productId = String(product.id ?? '');
    const productName = String(product.name ?? 'Unnamed product');
    const currentStock = Number(product.stock_quantity ?? 0);
    const threshold = Number(product.low_stock_threshold ?? 0);
    const usage = byProduct.get(productId);
    const activeDays = usage?.recentDays.size ?? 0;
    const avgDailyUsage = activeDays > 0 ? usage!.usage / activeDays : 0;
    const daysLeft = avgDailyUsage > 0 ? currentStock / avgDailyUsage : null;

    if (daysLeft !== null && daysLeft <= 14) {
      drafts.push({
        type: 'likely_stockout',
        entityType: 'product',
        entityId: productId,
        title: `Reorder ${productName}`,
        reason: `${productName} is likely to stock out soon.`,
        recommendedAction: 'record_purchase',
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
        title: `Reorder quantity for ${productName}`,
        reason: `Current stock will not comfortably cover the next month of usage.`,
        recommendedAction: 'record_purchase',
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
        title: `Reduce stock exposure on ${productName}`,
        reason: `${productName} is moving slowly relative to current stock.`,
        recommendedAction: 'review_overstock',
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
      title: `Move dead stock: ${String(row.product_name ?? 'product')}`,
      reason: `${String(row.product_name ?? 'This product')} has stock on hand without recent sales.`,
      recommendedAction: 'show_catalog',
      basis: { ...row },
      confidence: 0.75,
      estimatedImpact: Number(row.stock_value ?? 0) > 0 ? { tied_up_value: Number(row.stock_value) } : undefined,
    });
  }

  return drafts;
}

async function generateCustomerRecommendations(admin: SupabaseClient, tenantId: string): Promise<RecommendationDraft[]> {
  const { data: profiles, error } = await admin
    .from('customer_profile_summary')
    .select('customer_id, customer_name, lifetime_bookings, lifetime_value_cents, last_visit, repeat_interval_days, days_since_visit, outstanding_balance_cents')
    .eq('tenant_id', tenantId);

  if (error) throw error;

  const drafts: RecommendationDraft[] = [];
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
        title: `Follow up with ${customerName}`,
        reason: `${customerName} is due for a repeat purchase or rebooking window.`,
        recommendedAction: 'recover_lead',
        basis: {
          customer_id: customerId,
          customer_name: customerName,
          days_since_visit: daysSinceVisit,
          repeat_interval_days: repeatIntervalDays,
        },
        confidence: 0.8,
      });
    }

    if (daysSinceVisit >= 45) {
      drafts.push({
        type: 'reactivation',
        entityType: 'customer',
        entityId: customerId,
        title: `Reactivate ${customerName}`,
        reason: `${customerName} has been inactive for an extended period.`,
        recommendedAction: 'recover_lead',
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
        title: `Collect outstanding from ${customerName}`,
        reason: `${customerName} still has an unpaid balance.`,
        recommendedAction: 'record_outstanding_balance',
        basis: {
          customer_id: customerId,
          customer_name: customerName,
          outstanding_balance: outstanding,
        },
        confidence: 0.85,
        estimatedImpact: { recoverable_value: outstanding },
      });
    }
  }

  return drafts;
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
];

export async function runGenerators(admin: SupabaseClient, tenantId: string) {
  const drafts = (await Promise.all(GENERATORS.map((generator) => generator.generate(admin, tenantId)))).flat();
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
