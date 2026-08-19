import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recordMovement } from './recordMovement';
import { expectedAt } from './expectedStock';

type LocationRow = {
  id: string;
};

type SessionRow = {
  id: string;
  snapshot_at: string;
  tenant_id?: string;
  location_id?: string | null;
  status?: string;
};

type ProductRow = {
  id: string;
  cost_price_cents?: number | null;
  track_inventory?: boolean | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  is_active?: boolean | null;
};

type StockCountItemRow = {
  id: string;
  tenant_id?: string;
  session_id?: string;
  product_id?: string | null;
  variant_id?: string | null;
  location_id?: string | null;
  expected_quantity: number;
  counted_quantity?: number | null;
  variance?: number | null;
  unit_cost_cents?: number | null;
  variance_value_cents?: number | null;
  flags?: Record<string, unknown> | null;
};

type MovementDuringCountRow = {
  id?: string;
  product_id?: string | null;
  variant_id?: string | null;
  location_id?: string | null;
  movement_type?: string | null;
};

const EXTREME_VARIANCE_MULTIPLIER = 2;

function toStockKey(productId: string, variantId: string | null): string {
  return `${productId}|${variantId ?? 'base'}`;
}

function normalizeFlags(flags: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...(flags ?? {}) };
}

export function computeVariance(item: {
  expectedQuantity: number;
  countedQuantity: number;
  unitCostCents?: number | null;
  flags?: Record<string, unknown> | null;
}) {
  const variance = item.countedQuantity - item.expectedQuantity;
  const flags = normalizeFlags(item.flags);

  if (item.unitCostCents == null) {
    flags.cost_unknown = true;
  } else {
    delete flags.cost_unknown;
  }

  if (item.expectedQuantity > 0 && Math.abs(variance) > item.expectedQuantity * EXTREME_VARIANCE_MULTIPLIER) {
    flags.extreme_variance = true;
  } else {
    delete flags.extreme_variance;
  }

  return {
    variance,
    varianceValueCents: item.unitCostCents == null ? null : variance * item.unitCostCents,
    flags,
  };
}

export async function startCountSession(
  admin: SupabaseClient,
  tenantId: string,
  locationId: string | null,
  startedBy: string
) {
  const { data: defaultLocation, error: defaultLocationError } = await admin
    .from('inventory_locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .maybeSingle<LocationRow>();

  if (defaultLocationError) throw defaultLocationError;

  const resolvedLocationId = locationId ?? defaultLocation?.id ?? null;
  const snapshotAt = new Date().toISOString();

  const { data: session, error: sessionError } = await admin
    .from('stock_count_sessions')
    .insert({
      tenant_id: tenantId,
      location_id: resolvedLocationId,
      status: 'counting',
      started_by: startedBy,
      snapshot_at: snapshotAt,
    })
    .select('id, snapshot_at')
    .single<SessionRow>();

  if (sessionError) throw sessionError;
  if (!session) throw new Error('Failed to create stock count session');

  const totals = await expectedAt(admin, tenantId, snapshotAt, resolvedLocationId);

  const [{ data: products, error: productsError }, { data: variants, error: variantsError }] = await Promise.all([
    admin
      .from('products')
      .select('id, cost_price_cents, track_inventory')
      .eq('tenant_id', tenantId)
      .eq('track_inventory', true),
    admin
      .from('product_variants')
      .select('id, product_id, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true),
  ]);

  if (productsError) throw productsError;
  if (variantsError) throw variantsError;

  const activeVariants = new Map<string, VariantRow[]>();
  for (const variant of (variants ?? []) as VariantRow[]) {
    const rows = activeVariants.get(variant.product_id) ?? [];
    rows.push(variant);
    activeVariants.set(variant.product_id, rows);
  }

  const items = [];
  for (const product of (products ?? []) as ProductRow[]) {
    const productVariants = activeVariants.get(product.id) ?? [];
    if (productVariants.length > 0) {
      for (const variant of productVariants) {
        items.push({
          tenant_id: tenantId,
          session_id: session.id,
          product_id: product.id,
          variant_id: variant.id,
          location_id: resolvedLocationId,
          expected_quantity: totals.get(toStockKey(product.id, variant.id)) ?? 0,
          unit_cost_cents: product.cost_price_cents ?? null,
          flags: product.cost_price_cents == null ? { cost_unknown: true } : {},
        });
      }
      continue;
    }

    items.push({
      tenant_id: tenantId,
      session_id: session.id,
      product_id: product.id,
      variant_id: null,
      location_id: resolvedLocationId,
      expected_quantity: totals.get(toStockKey(product.id, null)) ?? 0,
      unit_cost_cents: product.cost_price_cents ?? null,
      flags: product.cost_price_cents == null ? { cost_unknown: true } : {},
    });
  }

  if (items.length > 0) {
    const { error: itemError } = await admin.from('stock_count_items').insert(items);
    if (itemError) throw itemError;
  }

  return session;
}

export async function listCountSessions(
  admin: SupabaseClient,
  tenantId: string
) {
  const { data, error } = await admin
    .from('stock_count_sessions')
    .select('id, tenant_id, location_id, status, started_by, snapshot_at, approved_by, approved_at, shrinkage_value_cents, notes, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getCountSessionWithItems(
  admin: SupabaseClient,
  tenantId: string,
  sessionId: string
) {
  const { data: session, error: sessionError } = await admin
    .from('stock_count_sessions')
    .select('id, tenant_id, location_id, status, started_by, snapshot_at, approved_by, approved_at, shrinkage_value_cents, notes, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', sessionId)
    .maybeSingle<SessionRow & { shrinkage_value_cents?: number | null; notes?: string | null; created_at?: string }>();

  if (sessionError) throw sessionError;
  if (!session) throw new Error(`Stock count session ${sessionId} not found`);

  const { data: items, error: itemsError } = await admin
    .from('stock_count_items')
    .select('id, tenant_id, session_id, product_id, variant_id, location_id, expected_quantity, counted_quantity, variance, unit_cost_cents, variance_value_cents, flags, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (itemsError) throw itemsError;

  return {
    session,
    items: items ?? [],
  };
}

export async function enterCount(
  admin: SupabaseClient,
  itemId: string,
  countedQuantity: number
) {
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new Error('counted_quantity must be a non-negative integer');
  }

  const { data: item, error: itemError } = await admin
    .from('stock_count_items')
    .select('id, expected_quantity, counted_quantity, unit_cost_cents, flags')
    .eq('id', itemId)
    .single<StockCountItemRow>();

  if (itemError) throw itemError;
  if (!item) throw new Error(`Stock count item ${itemId} not found`);

  const computed = computeVariance({
    expectedQuantity: Number(item.expected_quantity ?? 0),
    countedQuantity,
    unitCostCents: item.unit_cost_cents ?? null,
    flags: item.flags ?? {},
  });

  const { data: updated, error: updateError } = await admin
    .from('stock_count_items')
    .update({
      counted_quantity: countedQuantity,
      variance: computed.variance,
      variance_value_cents: computed.varianceValueCents,
      flags: computed.flags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .select('*')
    .single();

  if (updateError) throw updateError;

  return updated;
}

export async function approveSession(
  admin: SupabaseClient,
  sessionId: string,
  approverId: string,
  tenantIdOverride?: string
) {
  let sessionQuery = admin
    .from('stock_count_sessions')
    .select('id, tenant_id, location_id, snapshot_at, status')
    .eq('id', sessionId);

  if (tenantIdOverride) {
    sessionQuery = sessionQuery.eq('tenant_id', tenantIdOverride);
  }

  const { data: session, error: sessionError } = await sessionQuery.single<SessionRow>();

  if (sessionError) throw sessionError;
  if (!session) throw new Error(`Stock count session ${sessionId} not found`);

  if (session.status === 'approved') {
    return session;
  }

  const { data: items, error: itemsError } = await admin
    .from('stock_count_items')
    .select('id, tenant_id, session_id, product_id, variant_id, location_id, expected_quantity, counted_quantity, variance, unit_cost_cents, variance_value_cents, flags')
    .eq('session_id', sessionId);

  if (itemsError) throw itemsError;

  const nowIso = new Date().toISOString();
  const tenantId = session.tenant_id ?? '';
  const movementRows = ((await admin
    .from('inventory_movements')
    .select('id, product_id, variant_id, location_id, movement_type')
    .eq('tenant_id', tenantId)
    .gte('created_at', session.snapshot_at ?? nowIso)
    .lt('created_at', nowIso)) as { data?: unknown; error?: Error | null });
  if (movementRows.error) throw movementRows.error;

  const liveMovements = ((movementRows.data ?? []) as MovementDuringCountRow[]).filter(
    (row) => row.movement_type !== 'count_adjustment'
  );

  let shrinkageValueCents = 0;
  const eventItems: Array<Record<string, unknown>> = [];

  for (const item of (items ?? []) as StockCountItemRow[]) {
    if (item.counted_quantity == null) continue;

    const movedDuringCount = liveMovements.some((movement) =>
      movement.product_id === item.product_id &&
      (movement.variant_id ?? null) === (item.variant_id ?? null) &&
      (movement.location_id ?? session.location_id ?? null) === (item.location_id ?? session.location_id ?? null)
    );

    if (movedDuringCount) {
      const nextFlags = { ...normalizeFlags(item.flags), moved_during_count: true };
      await admin
        .from('stock_count_items')
        .update({ flags: nextFlags, updated_at: nowIso })
        .eq('id', item.id);
      continue;
    }

    const variance = Number(item.variance ?? (Number(item.counted_quantity) - Number(item.expected_quantity)));
    const varianceValueCents = item.unit_cost_cents == null ? null : variance * item.unit_cost_cents;

    if (variance < 0 && varianceValueCents != null) {
      shrinkageValueCents += Math.abs(varianceValueCents);
    }

    if (variance !== 0) {
      await recordMovement(admin, {
        tenantId,
        productId: item.product_id ?? null,
        variantId: item.variant_id ?? null,
        locationId: item.location_id ?? session.location_id ?? null,
        movementType: 'count_adjustment',
        quantityChange: variance,
        unitCostCents: item.unit_cost_cents ?? null,
        referenceType: 'stock_count_item',
        referenceId: item.id,
        actorId: approverId,
        reason: 'Approved stock count adjustment',
      });
    }

    eventItems.push({
      item_id: item.id,
      product_id: item.product_id ?? null,
      variant_id: item.variant_id ?? null,
      location_id: item.location_id ?? session.location_id ?? null,
      variance,
      variance_value_cents: varianceValueCents,
      unit_cost_cents: item.unit_cost_cents ?? null,
      counted_quantity: item.counted_quantity,
      expected_quantity: item.expected_quantity,
      flags: item.flags ?? {},
    });
  }

  const { data: updatedSession, error: updateSessionError } = await admin
    .from('stock_count_sessions')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: nowIso,
      shrinkage_value_cents: shrinkageValueCents,
    })
    .eq('id', sessionId)
    .select('*')
    .single();

  if (updateSessionError) throw updateSessionError;

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: approverId,
    action: BUSINESS_EVENT_ACTIONS.STOCK_COUNT_APPROVED,
    entityType: 'stock_count_session',
    entityId: sessionId,
    source: 'dashboard',
    metadata: {
      session_id: sessionId,
      location_id: session.location_id ?? null,
      shrinkage_value_cents: shrinkageValueCents,
      items: eventItems,
    },
  });

  return updatedSession;
}
