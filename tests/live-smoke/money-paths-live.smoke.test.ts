/**
 * Scoped, self-cleaning LIVE smoke for the MONEY paths against a real Supabase.
 *
 * Mocked unit tests cannot catch DB-schema/relationship/atomicity defects on the
 * money-moving flows. This exercises them against real Postgres:
 *   1. Retail sale  — record_retail_sale_tx: order + ledger sale txn + atomic
 *      inventory decrement.
 *   2. Refund       — refund_retail_sale_tx: inventory restock, order flipped to
 *      refunded, negative refund txn linked to the sale, and IDEMPOTENCY (a second
 *      refund must not double-restock or write a second refund).
 *   3. Approval-gated refund — the full production path createApprovalRequest ->
 *      decideApproval -> executeAction -> refund_retail_sale_tx, proving an
 *      owner-approved refund actually moves money exactly once.
 *
 * Everything is scoped to one throwaway tenant, deleted in afterAll even if an
 * assertion fails. No real tenant data is touched.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createApprovalRequest, decideApproval } from '@/lib/approvals/requests';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MARK = `__livesmoke_money_${Date.now()}`;
const UNIT_PRICE = 5000; // ₦50.00
const START_STOCK = 10;

let admin: SupabaseClient;
let tenantId: string;
let productId: string;
let customerId: string;
const ownerId = randomUUID(); // approver
const staffId = randomUUID(); // requester (must differ from approver)

async function insert<T = { id: string }>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.from(table).insert(row).select('*').single();
  if (error) throw new Error(`insert ${table} failed: ${error.message}`);
  return data as T;
}

async function stockOf(): Promise<number> {
  const { data, error } = await admin
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .single();
  if (error) throw new Error(`read stock failed: ${error.message}`);
  return Number(data!.stock_quantity);
}

async function sell(quantity: number): Promise<{ orderId: string; totalCents: number }> {
  const { data, error } = await admin.rpc('record_retail_sale_tx', {
    p_tenant_id: tenantId,
    p_actor_user_id: ownerId,
    p_items: [{ product_id: productId, variant_id: null, quantity, unit_price_cents: UNIT_PRICE }],
    p_customer_id: customerId,
  });
  if (error) throw new Error(`record_retail_sale_tx failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { orderId: String(row.order_id), totalCents: Number(row.total_cents) };
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the live smoke');
  }
  // The approval path routes through the module-global admin client, which reads
  // NEXT_PUBLIC_SUPABASE_URL — ensure it resolves to the same project.
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;

  admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const tenant = await insert('tenants', { name: MARK });
  tenantId = tenant.id;

  const customer = await insert('customers', {
    tenant_id: tenantId,
    name: 'Money Smoke Customer',
    customer_name: 'Money Smoke Customer',
    phone: '+2348090000002',
    phone_number: '+2348090000002',
    normalized_phone: '+2348090000002',
    no_show_count: 0,
    risk_score: 'low',
    tags: [],
  });
  customerId = customer.id;

  const product = await insert('products', {
    tenant_id: tenantId,
    name: 'Smoke Product',
    price_cents: UNIT_PRICE,
    track_inventory: true,
    stock_quantity: START_STOCK,
  });
  productId = product.id;
});

afterAll(async () => {
  if (!admin || !tenantId) return;
  const byTenant = [
    'approval_actions',
    'approval_requests',
    'business_events',
    'transactions',
    'inventory_movements',
    'retail_order_items',
    'retail_orders',
    'products',
    'customers',
  ];
  for (const t of byTenant) {
    try {
      await admin.from(t).delete().eq('tenant_id', tenantId);
    } catch {
      /* table may not carry tenant rows — ignore */
    }
  }
  try {
    await admin.from('tenants').delete().eq('id', tenantId);
  } catch {
    /* ignore */
  }
});

describe('LIVE money paths (scoped tenant, self-cleaning)', () => {
  it('retail sale records a ledger sale txn and atomically decrements inventory', async () => {
    const qty = 3;
    const { orderId, totalCents } = await sell(qty);

    expect(totalCents).toBe(UNIT_PRICE * qty); // 15000
    expect(await stockOf()).toBe(START_STOCK - qty); // 7

    const { data: order } = await admin
      .from('retail_orders')
      .select('payment_status, total_cents')
      .eq('id', orderId)
      .single();
    expect(order!.payment_status).toBe('paid');
    expect(Number(order!.total_cents)).toBe(UNIT_PRICE * qty);

    const { data: sale } = await admin
      .from('transactions')
      .select('type, status, subject_id')
      .eq('tenant_id', tenantId)
      .eq('subject_type', 'retail_order')
      .eq('subject_id', orderId)
      .eq('type', 'sale')
      .maybeSingle();
    expect(sale).not.toBeNull();
    expect(sale!.status).toBe('success');
  });

  it('refund restocks inventory, flips the order, writes a linked refund txn, and is idempotent', async () => {
    const qty = 2;
    const { orderId } = await sell(qty);
    const afterSale = await stockOf(); // START_STOCK - 3 (prev test) - 2

    const { data: saleTxn } = await admin
      .from('transactions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('subject_id', orderId)
      .eq('type', 'sale')
      .single();

    const { error: refundErr } = await admin.rpc('refund_retail_sale_tx', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_actor_user_id: ownerId,
      p_reason: 'smoke refund',
    });
    expect(refundErr).toBeNull();

    // Inventory restocked by the refunded quantity.
    expect(await stockOf()).toBe(afterSale + qty);

    // Order flipped to refunded/cancelled.
    const { data: order } = await admin
      .from('retail_orders')
      .select('payment_status, status')
      .eq('id', orderId)
      .single();
    expect(order!.payment_status).toBe('refunded');
    expect(order!.status).toBe('cancelled');

    // Exactly one refund txn, linked to the original sale.
    const { data: refunds } = await admin
      .from('transactions')
      .select('id, type, original_transaction_id, refund_amount')
      .eq('tenant_id', tenantId)
      .eq('subject_id', orderId)
      .eq('type', 'refund');
    expect((refunds ?? []).length).toBe(1);
    expect(refunds![0].original_transaction_id).toBe(saleTxn!.id);
    expect(Number(refunds![0].refund_amount)).toBe((UNIT_PRICE * qty) / 100);

    // IDEMPOTENCY: a second refund must not double-restock or double-write.
    const stockBefore2nd = await stockOf();
    const { error: refundErr2 } = await admin.rpc('refund_retail_sale_tx', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_actor_user_id: ownerId,
      p_reason: 'smoke refund retry',
    });
    expect(refundErr2).toBeNull();
    expect(await stockOf()).toBe(stockBefore2nd); // no extra restock
    const { data: refunds2 } = await admin
      .from('transactions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('subject_id', orderId)
      .eq('type', 'refund');
    expect((refunds2 ?? []).length).toBe(1); // still exactly one
  });

  it('owner-approved refund (createApprovalRequest -> decideApproval) moves money exactly once', async () => {
    const qty = 1;
    const { orderId } = await sell(qty);
    const afterSale = await stockOf();

    const request = await createApprovalRequest(admin, {
      tenantId,
      requestType: 'refund',
      requestedBy: staffId,
      subjectType: 'retail_order',
      subjectId: orderId,
      actionPayload: {
        action: 'refund_sale',
        params: { order_id: orderId, reason: 'approved smoke refund' },
        reply: 'Refund approved',
        confidence: 'high',
      },
      requiredPermission: 'APPROVE_REFUNDS',
    });
    expect(request.status).toBe('pending');

    const decided = await decideApproval(admin, {
      requestId: request.id,
      actorId: ownerId,
      actorPerms: ['APPROVE_REFUNDS'],
      decision: 'approve',
    });
    expect(decided.status).toBe('approved');

    // The refund actually executed: order refunded + inventory restocked.
    const { data: order } = await admin
      .from('retail_orders')
      .select('payment_status')
      .eq('id', orderId)
      .single();
    expect(order!.payment_status).toBe('refunded');
    expect(await stockOf()).toBe(afterSale + qty);

    const { data: refunds } = await admin
      .from('transactions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('subject_id', orderId)
      .eq('type', 'refund');
    expect((refunds ?? []).length).toBe(1); // executed exactly once
  });
});
