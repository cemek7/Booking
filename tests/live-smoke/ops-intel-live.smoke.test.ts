/**
 * Scoped, self-cleaning LIVE smoke against a real Supabase.
 *
 * Exercises the load-bearing ops-intel seams with the REAL flow code:
 *   1. Reservation completion (spec 1/§A/H/N): multi-service snapshot +
 *      completion event via markReservationCompleted.
 *   2. Approval atomic claim (G1): the pending->approved conditional update is a
 *      real single-winner gate on Postgres.
 *
 * Everything is scoped to one throwaway tenant, deleted in afterAll even if an
 * assertion fails. No real tenant data is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { markReservationCompleted } from '@/lib/reconciliation/reservationSnapshot';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MARK = `__livesmoke_${Date.now()}`;

let admin: SupabaseClient;
let tenantId: string;
let customerId: string;
let serviceId: string;
let reservationId: string;
let approvalId: string | null = null;

async function insert<T = { id: string }>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.from(table).insert(row).select('*').single();
  if (error) throw new Error(`insert ${table} failed: ${error.message}`);
  return data as T;
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the live smoke');
  }
  admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const tenant = await insert('tenants', { name: MARK });
  tenantId = tenant.id;

  const customer = await insert('customers', {
    tenant_id: tenantId,
    name: 'Smoke Customer',
    customer_name: 'Smoke Customer',
    phone: '+2348090000001',
    phone_number: '+2348090000001',
    normalized_phone: '+2348090000001',
    no_show_count: 0,
    risk_score: 'low',
    tags: [],
  });
  customerId = customer.id;

  const service = await insert('services', {
    tenant_id: tenantId,
    name: 'Smoke Service',
    price_cents: 5000,
    duration_minutes: 60,
  });
  serviceId = service.id;

  const startAt = new Date(Date.now() - 3600_000).toISOString();
  const endAt = new Date().toISOString();
  const reservation = await insert('reservations', {
    tenant_id: tenantId,
    customer_id: customerId,
    service_id: serviceId,
    status: 'confirmed',
    discount_cents: 0,
    start_at: startAt,
    end_at: endAt,
  });
  reservationId = reservation.id;

  // Two service lines (qty 2) — snapshot must be price_cents * quantity summed.
  await insert('reservation_services', {
    reservation_id: reservationId,
    service_id: serviceId,
    tenant_id: tenantId,
    customer_id: customerId,
    quantity: 2,
  });
});

afterAll(async () => {
  if (!admin || !tenantId) return;
  // Best-effort teardown in FK-safe order; scoped strictly to the test tenant.
  const byTenant = ['business_events', 'business_anomalies', 'ai_action_log', 'customer_merge_candidates'];
  for (const t of byTenant) {
    try {
      await admin.from(t).delete().eq('tenant_id', tenantId);
    } catch {
      /* table may not carry tenant rows — ignore */
    }
  }
  if (approvalId) {
    try {
      await admin.from('approval_requests').delete().eq('tenant_id', tenantId);
    } catch {
      /* ignore */
    }
  }
  try {
    await admin.from('reservation_services').delete().eq('reservation_id', reservationId);
  } catch {
    /* ignore */
  }
  for (const t of ['reservations', 'services', 'customers']) {
    try {
      await admin.from(t).delete().eq('tenant_id', tenantId);
    } catch {
      /* ignore */
    }
  }
  try {
    await admin.from('tenants').delete().eq('id', tenantId);
  } catch {
    /* ignore */
  }
});

describe('LIVE ops-intel smoke (scoped tenant, self-cleaning)', () => {
  it('reservation completion writes a multi-service price snapshot + completion event', async () => {
    await markReservationCompleted(admin, tenantId, reservationId, null);

    const { data: reservation, error } = await admin
      .from('reservations')
      .select('status, completed_at, price_cents_snapshot')
      .eq('id', reservationId)
      .single();
    expect(error).toBeNull();
    expect(reservation!.status).toBe('completed');
    expect(reservation!.completed_at).toBeTruthy();
    // 5000 price_cents * quantity 2.
    expect(Number(reservation!.price_cents_snapshot)).toBe(10000);

    const { data: events } = await admin
      .from('business_events')
      .select('action, entity_id')
      .eq('tenant_id', tenantId)
      .eq('action', 'reservation.completed');
    expect((events ?? []).some((e) => e.entity_id === reservationId)).toBe(true);
  });

  it('approval claim is a single-winner gate (G1) — only one of two concurrent claims wins', async () => {
    const request = await insert('approval_requests', {
      tenant_id: tenantId,
      request_type: 'refund',
      required_permission: 'APPROVE_REFUNDS',
      status: 'pending',
      action_payload: { action: 'refund_sale', params: { order_id: 'smoke' }, reply: 'ok', confidence: 'high' },
    });
    approvalId = request.id;

    const claim = () =>
      admin
        .from('approval_requests')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', approvalId!)
        .eq('status', 'pending')
        .select('id');

    const [a, b] = await Promise.all([claim(), claim()]);
    const winners = [a, b].filter((r) => (r.data ?? []).length === 1).length;
    // Exactly one conditional update may flip pending->approved.
    expect(winners).toBe(1);
  });
});
