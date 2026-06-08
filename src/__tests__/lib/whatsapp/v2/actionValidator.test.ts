/**
 * Tests for validateWalkIn (exercised via validateAction)
 *
 * validateWalkIn resolves staff/service identifiers, checks for scheduling
 * conflicts, and mutates params with resolved IDs before returning.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Supabase mock ──────────────────────────────────────────────────────────
// Each DB call shifts the next response off the queue in the order it was pushed.

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: DbRow; error: null }> = [];

function pushDb(data: DbRow) {
  responses.push({ data, error: null });
}

function makeChain() {
  const chain: Record<string, unknown> = {};
  const filters = ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not'];
  filters.forEach(m => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });
  (chain as any).maybeSingle = jest.fn().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? { data: null, error: null })
  );
  (chain as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
  (chain as any).upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  (chain as any).update = jest.fn().mockReturnValue(chain);
  return chain;
}

const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}));

jest.mock('@/lib/booking/engine', () => ({
  bookingEngine: { createBooking: jest.fn() },
}));

import { validateAction } from '@/lib/whatsapp/v2/actionValidator';
import type { AIResponse } from '@/lib/whatsapp/v2/actionValidator';

// ── Helpers ────────────────────────────────────────────────────────────────

const TENANT = 'tenant_test_abc';

function walkIn(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'walk_in', params, reply: 'Walk-in recorded', confidence: 'high' };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('validateAction — walk_in', () => {
  beforeEach(() => {
    responses.length = 0;
    jest.clearAllMocks();
  });

  it('returns invalid immediately when no staff identifier is provided', async () => {
    const result = await validateAction(TENANT, walkIn({}));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/staff identifier/i);
    // No DB queries needed
    expect(mockClient.from).not.toHaveBeenCalledWith('tenant_users');
  });

  it('returns invalid when staff_name lookup finds no matching staff', async () => {
    pushDb(null); // tenant_users → not found

    const result = await validateAction(TENANT, walkIn({ staff_name: 'Ada' }));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/staff identifier/i);
    expect(result.retryContext).toMatch(/staff member/i);
  });

  it('returns invalid with conflict details when staff has an active booking', async () => {
    // tenant_staff_id provided directly — no staff lookup
    // service_id provided directly — fetch duration
    pushDb({ duration_minutes: 45 }); // services

    // Conflict found
    const conflictEndAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    pushDb({ start_at: new Date().toISOString(), end_at: conflictEndAt, customer_name: 'Chisom' }); // reservations

    const result = await validateAction(TENANT, walkIn({
      tenant_staff_id: 'staff_1',
      service_id: 'svc_1',
    }));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/active booking/i);
    expect(result.retryContext).toMatch(/Chisom/);
  });

  it('returns valid and mutates params when no conflict (pre-resolved IDs)', async () => {
    pushDb({ duration_minutes: 30 }); // services duration
    pushDb(null); // reservations conflict → none

    const params: Record<string, unknown> = { tenant_staff_id: 'staff_1', service_id: 'svc_1' };
    const result = await validateAction(TENANT, walkIn(params));

    expect(result.valid).toBe(true);
    expect(params.resolved_staff_id).toBe('staff_1');
    expect(params.resolved_service_id).toBe('svc_1');
    expect(typeof params.walk_in_start_at).toBe('string');
    expect(typeof params.walk_in_end_at).toBe('string');
    // Duration should be ~30 minutes
    const durationMs =
      new Date(params.walk_in_end_at as string).getTime() -
      new Date(params.walk_in_start_at as string).getTime();
    expect(durationMs).toBeGreaterThanOrEqual(29 * 60 * 1000);
    expect(durationMs).toBeLessThanOrEqual(31 * 60 * 1000);
  });

  it('resolves staff and service by name and returns valid', async () => {
    pushDb({ id: 'staff_resolved' }); // tenant_users
    pushDb({ id: 'svc_resolved', duration_minutes: 60 }); // services
    pushDb(null); // conflict → none

    const params: Record<string, unknown> = { staff_name: 'Ada', service_name: 'Trim' };
    const result = await validateAction(TENANT, walkIn(params));

    expect(result.valid).toBe(true);
    expect(params.resolved_staff_id).toBe('staff_resolved');
    expect(params.resolved_service_id).toBe('svc_resolved');
  });

  it('defaults to 60-minute duration when service has no entry', async () => {
    pushDb({ id: 'staff_1' }); // tenant_users — staff found by name
    // No service_name, no service_id → skip service lookup, default 60 min
    pushDb(null); // reservations conflict → none

    const params: Record<string, unknown> = { staff_name: 'Ada' };
    await validateAction(TENANT, walkIn(params));

    const durationMs =
      new Date(params.walk_in_end_at as string).getTime() -
      new Date(params.walk_in_start_at as string).getTime();
    expect(durationMs).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(durationMs).toBeLessThanOrEqual(61 * 60 * 1000);
  });
});
