import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAction, validateAction, type AIResponse } from '@/lib/booking/action-validator';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

export type RecommendationStatus =
  | 'pending'
  | 'accepted'
  | 'dismissed'
  | 'snoozed'
  | 'expired';

export type RecommendationDecision = 'accept' | 'dismiss' | 'snooze';

export interface RecommendationRecord {
  id: string;
  tenant_id: string;
  type: string;
  title: string;
  reason: string;
  recommended_action: string;
  basis: Record<string, unknown> | null;
  estimated_impact?: Record<string, unknown> | null;
  confidence?: number | null;
  status: RecommendationStatus;
  snooze_until?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at: string;
}

export interface RecommendationFilters {
  status?: RecommendationStatus | string;
  type?: string;
  includeSnoozed?: boolean;
}

export interface RecommendationExecutionResult {
  executed: boolean;
  manualOnly: boolean;
  actionId: string | null;
  data?: unknown;
}

export interface RecommendationThresholds {
  likelyStockoutDays: number;
  reactivationDays: number;
  underbookedMinSlots: number;
  overbookedMaxSlots: number;
  lowMarginPercent: number;
  churnRiskMinDays: number;
}

export const DEFAULT_RECOMMENDATION_THRESHOLDS: RecommendationThresholds = {
  likelyStockoutDays: 14,
  reactivationDays: 45,
  underbookedMinSlots: 6,
  overbookedMaxSlots: 2,
  lowMarginPercent: 35,
  churnRiskMinDays: 30,
};

const DEFAULT_EXPIRY_DAYS: Record<string, number> = {
  likely_stockout: 21,
  reorder_qty: 21,
  overstock: 30,
  dead_stock: 30,
  repeat_purchase_due: 30,
  reactivation: 45,
  outstanding_reminder: 21,
  churn_risk: 30,
  underbooked_slot: 7,
  overbooked_staff: 14,
  poor_margin_service: 30,
  bundle: 21,
  upsell: 21,
  cross_sell: 21,
};

function localDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function getActionIdForRecommendation(type: string): string | null {
  switch (type) {
    case 'likely_stockout':
    case 'reorder_qty':
      return 'record_purchase';
    case 'repeat_purchase_due':
    case 'reactivation':
    case 'outstanding_reminder':
    case 'churn_risk':
      return 'recover_lead';
    default:
      return null;
  }
}

function enrichRecommendation(row: RecommendationRecord) {
  return {
    ...row,
    action_id: getActionIdForRecommendation(row.type),
    manual_only: getActionIdForRecommendation(row.type) == null,
  };
}

function parseDate(value: string | null | undefined) {
  const millis = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(millis) ? new Date(millis) : null;
}

function recommendationAgeDays(record: RecommendationRecord, now = new Date()) {
  const createdAt = parseDate(record.created_at);
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)));
}

async function buildPurchaseAction(
  admin: SupabaseClient,
  tenantId: string,
  recommendation: RecommendationRecord,
): Promise<AIResponse | null> {
  const productId = typeof recommendation.basis?.product_id === 'string'
    ? recommendation.basis.product_id
    : recommendation.entity_id;
  if (!productId) return null;

  const { data: product, error } = await admin
    .from('products')
    .select('id, name, cost_price_cents, price_cents, low_stock_threshold, stock_quantity')
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .maybeSingle<{
      id: string;
      name?: string | null;
      cost_price_cents?: number | null;
      price_cents?: number | null;
      low_stock_threshold?: number | null;
      stock_quantity?: number | null;
    }>();
  if (error) throw error;
  if (!product) return null;

  const suggestedQty = Number(
    recommendation.basis?.suggested_reorder_quantity
      ?? Math.max(Number(product.low_stock_threshold ?? 0) * 2 - Number(product.stock_quantity ?? 0), 1)
  );
  const quantity = Number.isFinite(suggestedQty) && suggestedQty > 0 ? Math.ceil(suggestedQty) : 1;
  const unitCostCents = Math.max(0, Number(product.cost_price_cents ?? product.price_cents ?? 0));

  return {
    action: 'record_purchase',
    confidence: 'high',
    reply: recommendation.recommended_action,
    params: {
      total_cents: unitCostCents * quantity,
      purchase_date: localDateString(),
      supplier_name: 'Recommendation restock',
      reason: recommendation.reason,
      items: [
        {
          product_id: product.id,
          product_name: product.name ?? 'Product',
          quantity,
          unit_cost_cents: unitCostCents,
        },
      ],
      metadata: {
        recommendation_id: recommendation.id,
        recommendation_type: recommendation.type,
      },
    },
  };
}

async function buildRecoverLeadAction(
  admin: SupabaseClient,
  tenantId: string,
  recommendation: RecommendationRecord,
): Promise<AIResponse | null> {
  const customerId = typeof recommendation.basis?.customer_id === 'string'
    ? recommendation.basis.customer_id
    : recommendation.entity_id;
  if (!customerId) return null;

  const { data: customer, error } = await admin
    .from('customers')
    .select('id, name, customer_name, phone, phone_number')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle<{
      id: string;
      name?: string | null;
      customer_name?: string | null;
      phone?: string | null;
      phone_number?: string | null;
    }>();
  if (error) throw error;
  if (!customer) return null;

  const phone = customer.phone ?? customer.phone_number ?? null;
  if (!phone) return null;

  return {
    action: 'recover_lead',
    confidence: 'high',
    reply: recommendation.recommended_action,
    params: {
      customer_phone: phone,
      customer_name: customer.name ?? customer.customer_name ?? 'Customer',
      reason: recommendation.reason,
      follow_up_at: addDays(new Date(), 1).toISOString(),
      recovery_message: recommendation.recommended_action,
      metadata: {
        recommendation_id: recommendation.id,
        recommendation_type: recommendation.type,
      },
    },
  };
}

async function buildActionPayload(
  admin: SupabaseClient,
  tenantId: string,
  recommendation: RecommendationRecord,
): Promise<AIResponse | null> {
  switch (recommendation.type) {
    case 'likely_stockout':
    case 'reorder_qty':
      return buildPurchaseAction(admin, tenantId, recommendation);
    case 'repeat_purchase_due':
    case 'reactivation':
    case 'outstanding_reminder':
    case 'churn_risk':
      return buildRecoverLeadAction(admin, tenantId, recommendation);
    default:
      return null;
  }
}

export async function listRecommendations(
  admin: SupabaseClient,
  tenantId: string,
  filters: RecommendationFilters = {},
  now = new Date(),
) {
  let query = admin
    .from('business_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.type) query = query.eq('type', filters.type);

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as RecommendationRecord[]).filter((row) => {
    if (filters.includeSnoozed) return true;
    if (row.status !== 'snoozed' || !row.snooze_until) return true;
    const snoozeUntil = parseDate(row.snooze_until);
    return !snoozeUntil || snoozeUntil.getTime() <= now.getTime();
  });

  return rows.map(enrichRecommendation);
}

export async function decideRecommendation(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    recommendationId: string;
    decision: RecommendationDecision;
    actorId: string | null;
    permissions?: string[];
    snoozeUntil?: string | null;
    note?: string | null;
  },
) {
  const { data: recommendation, error } = await admin
    .from('business_recommendations')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.recommendationId)
    .maybeSingle<RecommendationRecord>();
  if (error) throw error;
  if (!recommendation) throw new Error('Recommendation not found');

  let execution: RecommendationExecutionResult = {
    executed: false,
    manualOnly: true,
    actionId: getActionIdForRecommendation(recommendation.type),
  };

  if (input.decision === 'accept') {
    const payload = await buildActionPayload(admin, input.tenantId, recommendation);
    if (payload) {
      const validation = await validateAction(input.tenantId, payload);
      if (!validation.valid) {
        throw new Error(validation.error ?? 'Recommendation action failed validation');
      }

      const result = await executeAction(input.tenantId, payload, {
        actorId: input.actorId,
        permissions: input.permissions ?? [],
        userRole: 'owner',
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Recommendation action failed');
      }

      execution = {
        executed: true,
        manualOnly: false,
        actionId: payload.action,
        data: result.data,
      };
    }
  }

  const patch: Partial<RecommendationRecord> & { updated_at?: string } = input.decision === 'snooze'
    ? {
        status: 'snoozed',
        snooze_until: input.snoozeUntil ?? addDays(new Date(), 7).toISOString(),
      }
    : input.decision === 'dismiss'
      ? { status: 'dismissed', snooze_until: null }
      : { status: 'accepted', snooze_until: null };

  const { data: updated, error: updateError } = await admin
    .from('business_recommendations')
    .update(patch)
    .eq('tenant_id', input.tenantId)
    .eq('id', recommendation.id)
    .select('*')
    .single<RecommendationRecord>();
  if (updateError || !updated) throw updateError ?? new Error('Failed to update recommendation');

  await recordBusinessEvent(admin, {
    tenantId: input.tenantId,
    actorType: 'user',
    actorId: input.actorId,
    action:
      input.decision === 'accept'
        ? BUSINESS_EVENT_ACTIONS.RECOMMENDATION_ACCEPTED
        : input.decision === 'dismiss'
          ? BUSINESS_EVENT_ACTIONS.RECOMMENDATION_DISMISSED
          : BUSINESS_EVENT_ACTIONS.RECOMMENDATION_SNOOZED,
    entityType: 'business_recommendation',
    entityId: recommendation.id,
    source: 'dashboard',
    reason: input.note ?? null,
    metadata: {
      recommendation_type: recommendation.type,
      action_id: execution.actionId,
      executed: execution.executed,
      manual_only: execution.manualOnly,
      snooze_until: patch.snooze_until ?? null,
    },
  });

  return {
    recommendation: enrichRecommendation(updated),
    execution,
  };
}

async function insertOutcome(
  admin: SupabaseClient,
  recommendation: RecommendationRecord,
  outcome: 'acted' | 'ignored' | 'expired',
  observedEffect: Record<string, unknown>,
) {
  const { error } = await admin.from('recommendation_outcomes').insert({
    tenant_id: recommendation.tenant_id,
    recommendation_id: recommendation.id,
    outcome,
    observed_effect: observedEffect,
  });
  if (error) throw error;

  await recordBusinessEvent(admin, {
    tenantId: recommendation.tenant_id,
    actorType: 'system',
    action: BUSINESS_EVENT_ACTIONS.RECOMMENDATION_OUTCOME_RECORDED,
    entityType: 'business_recommendation',
    entityId: recommendation.id,
    source: 'system',
    metadata: {
      recommendation_type: recommendation.type,
      outcome,
      observed_effect: observedEffect,
    },
  });
}

async function detectRecommendationOutcome(
  admin: SupabaseClient,
  recommendation: RecommendationRecord,
  now = new Date(),
): Promise<{ outcome: 'acted' | 'ignored' | 'expired'; observedEffect: Record<string, unknown> } | null> {
  const ageDays = recommendationAgeDays(recommendation, now);
  const expiryDays = DEFAULT_EXPIRY_DAYS[recommendation.type] ?? 21;
  const entityId = recommendation.entity_id ?? null;
  const createdAt = recommendation.created_at;

  switch (recommendation.type) {
    case 'likely_stockout':
    case 'reorder_qty': {
      const productId = typeof recommendation.basis?.product_id === 'string'
        ? recommendation.basis.product_id
        : entityId;
      if (!productId) break;
      const { data, error } = await admin
        .from('inventory_movements')
        .select('id')
        .eq('tenant_id', recommendation.tenant_id)
        .eq('product_id', productId)
        .gt('quantity_change', 0)
        .gte('created_at', createdAt);
      if (error) throw error;
      if ((data ?? []).length > 0) {
        return { outcome: 'acted', observedEffect: { purchase_movements: data?.length ?? 0 } };
      }
      break;
    }
    case 'dead_stock':
    case 'bundle':
    case 'upsell':
    case 'cross_sell': {
      const productIds = [
        recommendation.basis?.product_id,
        recommendation.basis?.base_product_id,
        recommendation.basis?.suggested_product_id,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (!productIds.length) break;
      const { data, error } = await admin
        .from('retail_order_items')
        .select('id, product_id')
        .in('product_id', productIds);
      if (error) throw error;
      if ((data ?? []).length > 0) {
        return { outcome: 'acted', observedEffect: { sales_count: data?.length ?? 0 } };
      }
      break;
    }
    case 'repeat_purchase_due':
    case 'reactivation':
    case 'churn_risk': {
      const customerId = typeof recommendation.basis?.customer_id === 'string'
        ? recommendation.basis.customer_id
        : entityId;
      if (!customerId) break;
      const [{ data: reservations, error: reservationError }, { data: orders, error: ordersError }] = await Promise.all([
        admin
          .from('reservations')
          .select('id')
          .eq('tenant_id', recommendation.tenant_id)
          .eq('customer_id', customerId)
          .gte('created_at', createdAt),
        admin
          .from('retail_orders')
          .select('id')
          .eq('tenant_id', recommendation.tenant_id)
          .eq('customer_id', customerId)
          .gte('created_at', createdAt),
      ]);
      if (reservationError) throw reservationError;
      if (ordersError) throw ordersError;
      const actionCount = (reservations?.length ?? 0) + (orders?.length ?? 0);
      if (actionCount > 0) {
        return { outcome: 'acted', observedEffect: { followup_conversions: actionCount } };
      }
      break;
    }
    case 'outstanding_reminder': {
      const customerId = typeof recommendation.basis?.customer_id === 'string'
        ? recommendation.basis.customer_id
        : entityId;
      if (!customerId) break;
      const { data: profile, error } = await admin
        .from('customer_profile_summary')
        .select('outstanding_balance_cents')
        .eq('tenant_id', recommendation.tenant_id)
        .eq('customer_id', customerId)
        .maybeSingle<{ outstanding_balance_cents?: number | null }>();
      if (error) throw error;
      if (Number(profile?.outstanding_balance_cents ?? 0) <= 0) {
        return { outcome: 'acted', observedEffect: { balance_cleared: true } };
      }
      break;
    }
    case 'underbooked_slot': {
      const serviceId = typeof recommendation.basis?.service_id === 'string'
        ? recommendation.basis.service_id
        : null;
      const date = typeof recommendation.basis?.date === 'string' ? recommendation.basis.date : null;
      if (!serviceId || !date) break;
      const { data, error } = await admin
        .from('reservations')
        .select('id')
        .eq('tenant_id', recommendation.tenant_id)
        .eq('service_id', serviceId)
        .gte('start_at', `${date}T00:00:00`)
        .lt('start_at', `${date}T23:59:59`);
      if (error) throw error;
      if ((data ?? []).length > 0) {
        return { outcome: 'acted', observedEffect: { bookings_for_slot: data?.length ?? 0 } };
      }
      if (date < localDateString(now)) {
        return { outcome: recommendation.status === 'accepted' ? 'ignored' : 'expired', observedEffect: { slot_date: date } };
      }
      break;
    }
    case 'overbooked_staff': {
      const staffId = typeof recommendation.basis?.staff_id === 'string'
        ? recommendation.basis.staff_id
        : entityId;
      if (!staffId) break;
      const { data, error } = await admin
        .from('availability_snapshot')
        .select('available_slots')
        .eq('tenant_id', recommendation.tenant_id)
        .eq('staff_id', staffId)
        .gte('date', localDateString(now))
        .lt('date', localDateString(addDays(now, 7)));
      if (error) throw error;
      const slots = (data ?? []).reduce((sum, row) => sum + (Array.isArray(row.available_slots) ? row.available_slots.length : 0), 0);
      if (slots > Number(recommendation.basis?.remaining_slots ?? 0)) {
        return { outcome: 'acted', observedEffect: { available_slots: slots } };
      }
      break;
    }
    case 'poor_margin_service': {
      const serviceId = typeof recommendation.basis?.service_id === 'string'
        ? recommendation.basis.service_id
        : entityId;
      if (!serviceId) break;
      const { data, error } = await admin
        .from('service_performance_summary')
        .select('bookings, revenue')
        .eq('tenant_id', recommendation.tenant_id)
        .eq('service_id', serviceId)
        .maybeSingle<{ bookings?: number | null; revenue?: number | null }>();
      if (error) throw error;
      const bookings = Number(data?.bookings ?? 0);
      const revenue = Number(data?.revenue ?? 0);
      const currentAvg = bookings > 0 ? revenue / bookings : 0;
      if (currentAvg > Number(recommendation.basis?.avg_revenue_per_booking ?? 0)) {
        return { outcome: 'acted', observedEffect: { current_avg_revenue_per_booking: currentAvg } };
      }
      break;
    }
    default:
      break;
  }

  if (ageDays >= expiryDays) {
    return {
      outcome: recommendation.status === 'accepted' ? 'ignored' : 'expired',
      observedEffect: { age_days: ageDays, expiry_days: expiryDays },
    };
  }

  return null;
}

export async function observeOutcomes(
  admin: SupabaseClient,
  tenantId: string,
  now = new Date(),
) {
  const [{ data: recommendations, error: recommendationError }, { data: outcomes, error: outcomeError }] = await Promise.all([
    admin
      .from('business_recommendations')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'accepted', 'snoozed']),
    admin
      .from('recommendation_outcomes')
      .select('recommendation_id')
      .eq('tenant_id', tenantId),
  ]);
  if (recommendationError) throw recommendationError;
  if (outcomeError) throw outcomeError;

  const existing = new Set((outcomes ?? []).map((row) => String((row as { recommendation_id?: string }).recommendation_id ?? '')));
  const summary = { acted: 0, expired: 0, ignored: 0 };

  for (const recommendation of (recommendations ?? []) as RecommendationRecord[]) {
    if (existing.has(recommendation.id)) continue;
    const outcome = await detectRecommendationOutcome(admin, recommendation, now);
    if (!outcome) continue;

    await insertOutcome(admin, recommendation, outcome.outcome, outcome.observedEffect);
    summary[outcome.outcome] += 1;

    if (outcome.outcome === 'expired') {
      await admin
        .from('business_recommendations')
        .update({ status: 'expired' })
        .eq('tenant_id', tenantId)
        .eq('id', recommendation.id);
    }
  }

  return summary;
}

type OutcomeJoinRow = {
  outcome?: 'acted' | 'ignored' | 'expired' | null;
  recommendation?: { type?: string | null } | null;
};

export async function deriveRecommendationThresholds(
  admin: SupabaseClient,
  tenantId: string,
): Promise<RecommendationThresholds> {
  const { data, error } = await admin
    .from('recommendation_outcomes')
    .select('outcome, recommendation:business_recommendations(type)')
    .eq('tenant_id', tenantId);
  if (error) throw error;

  const stats = new Map<string, { acted: number; total: number }>();
  for (const row of (data ?? []) as OutcomeJoinRow[]) {
    const type = row.recommendation?.type;
    if (!type) continue;
    const entry = stats.get(type) ?? { acted: 0, total: 0 };
    entry.total += 1;
    if (row.outcome === 'acted') entry.acted += 1;
    stats.set(type, entry);
  }

  const thresholds = { ...DEFAULT_RECOMMENDATION_THRESHOLDS };

  const stockout = stats.get('likely_stockout');
  if (stockout && stockout.total >= 3) {
    const rate = stockout.acted / stockout.total;
    thresholds.likelyStockoutDays = rate >= 0.6 ? 21 : rate <= 0.25 ? 10 : thresholds.likelyStockoutDays;
  }

  const reactivation = stats.get('reactivation');
  if (reactivation && reactivation.total >= 3) {
    const rate = reactivation.acted / reactivation.total;
    thresholds.reactivationDays = rate >= 0.6 ? 35 : rate <= 0.25 ? 60 : thresholds.reactivationDays;
  }

  const underbooked = stats.get('underbooked_slot');
  if (underbooked && underbooked.total >= 3) {
    const rate = underbooked.acted / underbooked.total;
    thresholds.underbookedMinSlots = rate >= 0.6 ? 4 : rate <= 0.25 ? 8 : thresholds.underbookedMinSlots;
  }

  const overbooked = stats.get('overbooked_staff');
  if (overbooked && overbooked.total >= 3) {
    const rate = overbooked.acted / overbooked.total;
    thresholds.overbookedMaxSlots = rate >= 0.6 ? 3 : rate <= 0.25 ? 1 : thresholds.overbookedMaxSlots;
  }

  const margin = stats.get('poor_margin_service');
  if (margin && margin.total >= 3) {
    const rate = margin.acted / margin.total;
    thresholds.lowMarginPercent = rate >= 0.6 ? 40 : rate <= 0.25 ? 25 : thresholds.lowMarginPercent;
  }

  const churn = stats.get('churn_risk');
  if (churn && churn.total >= 3) {
    const rate = churn.acted / churn.total;
    thresholds.churnRiskMinDays = rate >= 0.6 ? 21 : rate <= 0.25 ? 45 : thresholds.churnRiskMinDays;
  }

  return thresholds;
}

function recommendationValueScore(recommendation: RecommendationRecord) {
  const impact = recommendation.estimated_impact ?? {};
  const numericImpact = Object.values(impact).find((value) => typeof value === 'number');
  return Number(numericImpact ?? recommendation.confidence ?? 0);
}

export async function sendHighValueRecommendationNudge(
  admin: SupabaseClient,
  tenantId: string,
  recommendations: RecommendationRecord[],
  now = new Date(),
) {
  const candidates = recommendations
    .filter((row) => row.status === 'pending')
    .sort((a, b) => recommendationValueScore(b) - recommendationValueScore(a))
    .slice(0, 3);
  if (!candidates.length) return { sent: false, count: 0 };

  const businessDate = localDateString(now);
  const { data: priorAlerts, error: priorAlertsError } = await admin
    .from('business_events')
    .select('entity_id')
    .eq('tenant_id', tenantId)
    .eq('action', BUSINESS_EVENT_ACTIONS.RECOMMENDATION_ALERTED)
    .gte('created_at', `${businessDate}T00:00:00`)
    .lt('created_at', `${businessDate}T23:59:59`);
  if (priorAlertsError) throw priorAlertsError;

  const alertedIds = new Set((priorAlerts ?? []).map((row) => String((row as { entity_id?: string }).entity_id ?? '')));
  const unsent = candidates.filter((row) => !alertedIds.has(row.id));
  if (!unsent.length) return { sent: false, count: 0 };

  const { data: owner, error: ownerError } = await admin
    .from('tenant_users')
    .select('phone, role')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'manager'])
    .not('phone', 'is', null)
    .order('role', { ascending: true })
    .maybeSingle<{ phone?: string | null; role?: string | null }>();
  if (ownerError) throw ownerError;
  if (!owner?.phone) return { sent: false, count: 0 };

  const client = await getTenantWhatsAppProviderClient(tenantId);
  if (!client) return { sent: false, count: 0 };

  const message = [
    '💡 *Booka recommendations*',
    ...unsent.map((row) => `• ${row.title}: ${row.recommended_action}`),
  ].join('\n');

  const result = await client.sendTextMessage(String(owner.phone), message);
  if (!result.success) return { sent: false, count: 0 };

  for (const recommendation of unsent) {
    await recordBusinessEvent(admin, {
      tenantId,
      actorType: 'system',
      action: BUSINESS_EVENT_ACTIONS.RECOMMENDATION_ALERTED,
      entityType: 'business_recommendation',
      entityId: recommendation.id,
      source: 'system',
      metadata: { recommendation_type: recommendation.type },
    });
  }

  return { sent: true, count: unsent.length };
}
