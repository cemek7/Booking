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

export const inventoryRules: AnomalyRule[] = [
  {
    key: 'stock_leaving_without_record',
    domain: 'inventory',
    severity: 'medium',
    mode: 'batch',
    detect: stockLeavingWithoutRecordDetect,
    dedupKey: (candidate) => `stock_leaving_without_record:${candidate.detail?.movement_id ?? candidate.entityId}`,
  },
];
