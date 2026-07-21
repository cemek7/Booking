import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recordMovement } from '@/lib/inventory/recordMovement';
import type { ActionHandler } from './registry';

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function ensureSupplier(
  admin: SupabaseClient,
  tenantId: string,
  supplierName: string | null,
): Promise<string | null> {
  if (!supplierName) return null;

  const { data: existing, error: existingError } = await admin
    .from('suppliers')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', supplierName)
    .maybeSingle<{ id: string }>();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await admin
    .from('suppliers')
    .insert({
      tenant_id: tenantId,
      name: supplierName,
    })
    .select('id')
    .single<{ id: string }>();

  if (createError || !created?.id) {
    throw createError ?? new Error('Failed to create supplier');
  }

  return created.id;
}

type ActionContext = { actorId?: string | null };

async function recordExpenseExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
) {
  const amountCents = getInteger(params.amount_cents);
  const expenseDate = getString(params.expense_date ?? params.date);
  const supplierId =
    getString(params.supplier_id)
    ?? await ensureSupplier(admin, tenantId, getString(params.supplier_name ?? params.supplier));

  if (amountCents === null || amountCents < 0 || !expenseDate) {
    return { success: false, error: 'record_expense requires amount_cents and expense_date' };
  }

  const payload = {
    tenant_id: tenantId,
    supplier_id: supplierId,
    media_input_id: getString(params.media_input_id),
    amount_cents: amountCents,
    expense_date: expenseDate,
    currency: getString(params.currency) ?? 'NGN',
    reference: getString(params.reference),
    notes: getString(params.notes),
    metadata: getObject(params.metadata) ?? {},
  };

  const { data, error } = await admin.from('expenses').insert(payload).select('*').single();
  if (error || !data) return { success: false, error: error?.message ?? 'Failed to record expense' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.EXPENSE_RECORDED,
    entityType: 'expense',
    entityId: String((data as { id: string }).id),
    source: 'dashboard',
    after: data,
    metadata: { amount_cents: amountCents, media_input_id: payload.media_input_id },
  });

  return { success: true, reply: 'Expense recorded.', data: { expense: data } };
}

async function recordPurchaseExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
) {
  const totalCents = getInteger(params.total_cents ?? params.amount_cents);
  const purchaseDate = getString(params.purchase_date ?? params.date);
  const supplierId =
    getString(params.supplier_id)
    ?? await ensureSupplier(admin, tenantId, getString(params.supplier_name ?? params.supplier));

  if (totalCents === null || totalCents < 0 || !purchaseDate) {
    return { success: false, error: 'record_purchase requires total_cents and purchase_date' };
  }

  const payload = {
    tenant_id: tenantId,
    supplier_id: supplierId,
    media_input_id: getString(params.media_input_id),
    total_cents: totalCents,
    purchase_date: purchaseDate,
    currency: getString(params.currency) ?? 'NGN',
    reference: getString(params.reference),
    status: getString(params.status) ?? 'recorded',
    metadata: getObject(params.metadata) ?? {},
  };

  const { data, error } = await admin.from('purchases').insert(payload).select('*').single();
  if (error || !data) return { success: false, error: error?.message ?? 'Failed to record purchase' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.PURCHASE_RECORDED,
    entityType: 'purchase',
    entityId: String((data as { id: string }).id),
    source: 'dashboard',
    after: data,
    metadata: { total_cents: totalCents, media_input_id: payload.media_input_id },
  });

  return { success: true, reply: 'Purchase recorded.', data: { purchase: data } };
}

async function recordSupplierPaymentExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
) {
  const amountCents = getInteger(params.amount_cents ?? params.payment_amount_cents);
  const paymentDate = getString(params.payment_date ?? params.date);
  const supplierId =
    getString(params.supplier_id)
    ?? await ensureSupplier(admin, tenantId, getString(params.supplier_name ?? params.supplier));

  if (amountCents === null || amountCents < 0 || !paymentDate) {
    return { success: false, error: 'record_supplier_payment requires amount_cents and payment_date' };
  }

  const payload = {
    tenant_id: tenantId,
    supplier_id: supplierId,
    purchase_id: getString(params.purchase_id),
    media_input_id: getString(params.media_input_id),
    amount_cents: amountCents,
    payment_date: paymentDate,
    currency: getString(params.currency) ?? 'NGN',
    reference: getString(params.reference),
    metadata: getObject(params.metadata) ?? {},
  };

  const { data, error } = await admin.from('supplier_payments').insert(payload).select('*').single();
  if (error || !data) return { success: false, error: error?.message ?? 'Failed to record supplier payment' };

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.SUPPLIER_PAYMENT_RECORDED,
    entityType: 'supplier_payment',
    entityId: String((data as { id: string }).id),
    source: 'dashboard',
    after: data,
    metadata: { amount_cents: amountCents, purchase_id: payload.purchase_id },
  });

  return { success: true, reply: 'Supplier payment recorded.', data: { supplier_payment: data } };
}

async function recordStockReceiptExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
) {
  const supplierId =
    getString(params.supplier_id)
    ?? await ensureSupplier(admin, tenantId, getString(params.supplier_name ?? params.supplier));

  const payload = {
    tenant_id: tenantId,
    purchase_id: getString(params.purchase_id),
    media_input_id: getString(params.media_input_id),
    supplier_id: supplierId,
    received_at: getString(params.received_at) ?? new Date().toISOString(),
    notes: getString(params.notes),
    metadata: getObject(params.metadata) ?? {},
  };

  const { data, error } = await admin.from('stock_receipts').insert(payload).select('*').single();
  if (error || !data) return { success: false, error: error?.message ?? 'Failed to record stock receipt' };

  const items = Array.isArray(params.items) ? params.items : [];
  for (const item of items) {
    const record = getObject(item);
    if (!record) continue;
    const quantity = getInteger(record.quantity ?? record.counted_units);
    if (quantity === null || quantity <= 0) continue;
    await recordMovement(admin, {
      tenantId,
      productId: getString(record.product_id),
      variantId: getString(record.variant_id),
      movementType: 'purchase',
      quantityChange: quantity,
      unitCostCents: getInteger(record.unit_cost_cents),
      reason: 'capture stock receipt',
      referenceType: 'stock_receipt',
      referenceId: String((data as { id: string }).id),
      actorId: ctx.actorId ?? null,
    });
  }

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId: ctx.actorId ?? null,
    action: BUSINESS_EVENT_ACTIONS.STOCK_RECEIPT_RECORDED,
    entityType: 'stock_receipt',
    entityId: String((data as { id: string }).id),
    source: 'dashboard',
    after: data,
    metadata: { item_count: items.length, purchase_id: payload.purchase_id },
  });

  return { success: true, reply: 'Stock receipt recorded.', data: { stock_receipt: data } };
}

export const captureHandlers: Record<string, ActionHandler> = {
  record_expense: {
    action: 'record_expense',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return {
        valid: getInteger(params.amount_cents) !== null && Boolean(getString(params.expense_date ?? params.date)),
        error: 'record_expense requires amount_cents and expense_date',
      };
    },
    execute: recordExpenseExecute,
  },
  record_purchase: {
    action: 'record_purchase',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return {
        valid: getInteger(params.total_cents ?? params.amount_cents) !== null && Boolean(getString(params.purchase_date ?? params.date)),
        error: 'record_purchase requires total_cents and purchase_date',
      };
    },
    execute: recordPurchaseExecute,
  },
  record_supplier_payment: {
    action: 'record_supplier_payment',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return {
        valid: getInteger(params.amount_cents ?? params.payment_amount_cents) !== null && Boolean(getString(params.payment_date ?? params.date)),
        error: 'record_supplier_payment requires amount_cents and payment_date',
      };
    },
    execute: recordSupplierPaymentExecute,
  },
  record_stock_receipt: {
    action: 'record_stock_receipt',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return {
        valid: Boolean(Array.isArray(params.items) ? params.items.length > 0 : getString(params.purchase_id) || getString(params.supplier_id) || getString(params.supplier_name)),
        error: 'record_stock_receipt requires stock items or purchase/supplier context',
      };
    },
    execute: recordStockReceiptExecute,
  },
};
