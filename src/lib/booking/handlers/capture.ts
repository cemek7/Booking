import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { recordMovement } from '@/lib/inventory/recordMovement';
import { enterCount, getCountSessionWithItems, startCountSession } from '@/lib/inventory/stockCountService';
import { markReservationCompleted } from '@/lib/reconciliation/reservationSnapshot';
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

async function findProductIdsByName(
  admin: SupabaseClient,
  tenantId: string,
  names: string[],
): Promise<Map<string, string>> {
  const normalizedNames = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  if (!normalizedNames.length) return new Map();

  const { data, error } = await admin
    .from('products')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('name', normalizedNames.map((name) => name));

  if (error) throw error;

  return new Map(
    (data ?? []).flatMap((row: { id?: string | null; name?: string | null }) => (
      row.id && row.name ? [[row.name.trim().toLowerCase(), row.id]] : []
    )),
  );
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

async function createStockCountSessionExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
) {
  const items = Array.isArray(params.items) ? params.items : [];
  const session = await startCountSession(admin, tenantId, getString(params.location_id), ctx.actorId ?? 'system');
  const sessionDetails = await getCountSessionWithItems(admin, tenantId, session.id);
  const productNames = items
    .map((item) => getString(getObject(item)?.product_name))
    .filter((value): value is string => Boolean(value));
  const productIdByName = await findProductIdsByName(admin, tenantId, productNames);

  for (const rawItem of items) {
    const item = getObject(rawItem);
    if (!item) continue;
    const countedQuantity = getInteger(item.counted_units ?? item.counted_quantity ?? item.quantity);
    if (countedQuantity === null) continue;

    const productId = getString(item.product_id)
      ?? productIdByName.get((getString(item.product_name) ?? '').trim().toLowerCase())
      ?? null;
    const variantId = getString(item.variant_id);

    const sessionItem = sessionDetails.items.find((row) => (
      String(row.product_id ?? '') === String(productId ?? '')
      && String(row.variant_id ?? '') === String(variantId ?? '')
    ));

    if (!sessionItem?.id) continue;
    await enterCount(admin, sessionItem.id, countedQuantity);
  }

  return {
    success: true,
    reply: 'Stock count session created from captured stock sheet.',
    data: { stock_count_session: session },
  };
}

async function completeServiceCaptureExecute(
  admin: SupabaseClient,
  tenantId: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
) {
  const reservationId = getString(params.reservation_id);
  if (!reservationId) {
    return { success: false, error: 'complete_service_capture requires reservation_id' };
  }

  const { data: reservation, error: reservationError } = await admin
    .from('reservations')
    .select('id, tenant_id, status, staff_id, tenant_staff_id')
    .eq('tenant_id', tenantId)
    .eq('id', reservationId)
    .maybeSingle<{ id: string; tenant_id: string; status?: string | null; staff_id?: string | null; tenant_staff_id?: string | null }>();

  if (reservationError) return { success: false, error: reservationError.message };
  if (!reservation) return { success: false, error: 'Reservation not found' };

  const staffId = getString(params.staff_id ?? params.tenant_staff_id);
  if (staffId) {
    const { error: updateError } = await admin
      .from('reservations')
      .update({
        staff_id: staffId,
        tenant_staff_id: staffId,
      })
      .eq('tenant_id', tenantId)
      .eq('id', reservationId);
    if (updateError) return { success: false, error: updateError.message };
  }

  if (reservation.status !== 'completed') {
    await markReservationCompleted(admin, tenantId, reservationId, ctx.actorId ?? null);
  }

  const paymentAmountCents = getInteger(params.payment_amount_cents ?? params.amount_cents);
  if (paymentAmountCents && paymentAmountCents > 0) {
    const transactionId = crypto.randomUUID();
    const payload = {
      id: transactionId,
      tenant_id: tenantId,
      reservation_id: reservationId,
      provider: 'manual_capture',
      provider_id: getString(params.reference) ?? transactionId,
      amount: paymentAmountCents / 100,
      currency: getString(params.currency) ?? 'NGN',
      status: 'success',
      type: 'payment',
      subject_type: 'reservation',
      subject_id: reservationId,
      raw: {
        source: 'multimodal_capture',
        payment_method: getString(params.payment_method),
        reference: getString(params.reference),
      },
      metadata: {
        source: 'multimodal_capture',
        payment_method: getString(params.payment_method),
        reference: getString(params.reference),
      },
    };

    const { data: transaction, error: transactionError } = await admin
      .from('transactions')
      .insert(payload)
      .select('*')
      .single();

    if (transactionError) return { success: false, error: transactionError.message };

    await recordBusinessEvent(admin, {
      tenantId,
      actorType: 'user',
      actorId: ctx.actorId ?? null,
      action: BUSINESS_EVENT_ACTIONS.PAYMENT_RECORDED,
      entityType: 'transaction',
      entityId: transactionId,
      source: 'dashboard',
      after: transaction,
      metadata: {
        reservation_id: reservationId,
        amount_cents: paymentAmountCents,
      },
    });
  }

  return {
    success: true,
    reply: 'Service completion recorded from captured note.',
    data: { reservation: { id: reservationId } },
  };
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
  create_stock_count_session: {
    action: 'create_stock_count_session',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return {
        valid: Array.isArray(params.items) && params.items.length > 0,
        error: 'create_stock_count_session requires one or more counted items',
      };
    },
    execute: createStockCountSessionExecute,
  },
  complete_service_capture: {
    action: 'complete_service_capture',
    requiresConfirmation: true,
    async validate(_admin, _tenantId, params) {
      return {
        valid: Boolean(getString(params.reservation_id)),
        error: 'complete_service_capture requires reservation_id',
      };
    },
    execute: completeServiceCaptureExecute,
  },
};
