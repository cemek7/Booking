import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnomalyCandidate } from '../upsertAnomaly';
import type { AnomalyRule, RuleContext, RuleWindow } from './registry';

type MovementRow = {
  id?: string;
  product_id?: string | null;
  movement_type?: string | null;
  quantity_change?: number | null;
  previous_quantity?: number | null;
  new_quantity?: number | null;
};

type TenantSettingsRow = {
  settings?: Record<string, unknown> | null;
};

type StockShrinkageEventItem = {
  item_id?: string | null;
  product_id?: string | null;
  variant_id?: string | null;
  location_id?: string | null;
  variance?: number | null;
  variance_value_cents?: number | null;
  unit_cost_cents?: number | null;
  counted_quantity?: number | null;
  expected_quantity?: number | null;
  flags?: Record<string, unknown> | null;
};

function readThreshold(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  const numberValue = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

async function stockLeavingWithoutRecordDetect(
  admin: SupabaseClient,
  tenantId: string,
  window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const { data, error } = await admin
    .from('inventory_movements')
    .select('id, product_id, movement_type, quantity_change, previous_quantity, new_quantity')
    .eq('tenant_id', tenantId)
    .gte('created_at', window.startUtc)
    .lt('created_at', window.endUtc);

  if (error) throw error;

  return ((data ?? []) as MovementRow[])
    .filter((row) => Number(row.quantity_change ?? 0) < 0)
    .filter((row) => row.movement_type === 'adjustment' || row.movement_type === 'manual_adjustment')
    .filter((row) => row.movement_type !== 'count_adjustment')
    .map((row) => ({
      tenantId,
      ruleKey: 'stock_leaving_without_record',
      domain: 'inventory',
      severity: 'medium',
      entityType: 'product',
      entityId: row.product_id ?? row.id ?? null,
      expectedValueCents: null,
      actualValueCents: null,
      differenceCents: null,
      detectionSource: ctx.eventAction ? 'realtime_event' : 'reconciliation',
      detail: {
        movement_id: row.id ?? null,
        movement_type: row.movement_type ?? null,
        quantity_change: row.quantity_change ?? null,
        previous_quantity: row.previous_quantity ?? null,
        new_quantity: row.new_quantity ?? null,
      },
    }));
}

async function stockShrinkageDetect(
  admin: SupabaseClient,
  tenantId: string,
  _window: RuleWindow,
  ctx: RuleContext
): Promise<AnomalyCandidate[]> {
  const eventItems = Array.isArray(ctx.eventMetadata?.items)
    ? (ctx.eventMetadata?.items as StockShrinkageEventItem[])
    : [];

  if (eventItems.length === 0) return [];

  const { data: tenantRow, error: tenantError } = await admin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle<TenantSettingsRow>();

  if (tenantError) throw tenantError;

  const settings = tenantRow?.settings ?? {};
  const valueThresholdCents = readThreshold(settings, 'stock_shrinkage_threshold_cents');
  const unitThreshold = readThreshold(settings, 'stock_shrinkage_threshold_units');
  const sessionId =
    typeof ctx.eventMetadata?.session_id === 'string' ? ctx.eventMetadata.session_id : null;

  return eventItems
    .filter((item) => Number(item.variance ?? 0) < 0)
    .filter((item) => !(item.flags && item.flags.moved_during_count === true))
    .filter((item) => {
      const units = Math.abs(Number(item.variance ?? 0));
      const value = Math.abs(Number(item.variance_value_cents ?? 0));
      return units > unitThreshold || value > valueThresholdCents;
    })
    .map((item) => {
      const actualValueCents = Math.abs(Number(item.variance_value_cents ?? 0));
      return {
        tenantId,
        ruleKey: 'stock_shrinkage',
        domain: 'inventory',
        severity: actualValueCents >= 50000 ? 'high' : 'medium',
        entityType: 'product',
        entityId: item.product_id ?? item.item_id ?? null,
        expectedValueCents:
          item.unit_cost_cents == null || Number(item.expected_quantity ?? 0) <= 0
            ? null
            : Number(item.expected_quantity ?? 0) * Number(item.unit_cost_cents),
        actualValueCents,
        differenceCents: actualValueCents,
        detectionSource: 'realtime_event',
        detail: {
          session_id: sessionId,
          stock_count_item_id: item.item_id ?? null,
          product_id: item.product_id ?? null,
          variant_id: item.variant_id ?? null,
          location_id: item.location_id ?? null,
          expected_quantity: item.expected_quantity ?? null,
          counted_quantity: item.counted_quantity ?? null,
          variance: item.variance ?? null,
          variance_value_cents: item.variance_value_cents ?? null,
          unit_cost_cents: item.unit_cost_cents ?? null,
          threshold_units: unitThreshold,
          threshold_value_cents: valueThresholdCents,
        },
      };
    });
}

export const inventoryRules: AnomalyRule[] = [
  {
    key: 'stock_leaving_without_record',
    domain: 'inventory',
    severity: 'medium',
    mode: 'batch',
    detect: stockLeavingWithoutRecordDetect,
    dedupKey: (candidate) => `stock_leaving_without_record:${candidate.detail?.movement_id ?? candidate.entityId}`,
  },
  {
    key: 'stock_shrinkage',
    domain: 'inventory',
    severity: 'medium',
    mode: 'realtime',
    triggerActions: ['stock_count.approved'],
    detect: stockShrinkageDetect,
    dedupKey: (candidate) =>
      `stock_shrinkage:${candidate.detail?.session_id ?? 'unknown'}:${candidate.detail?.stock_count_item_id ?? candidate.entityId}`,
  },
];
