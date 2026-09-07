import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo: jest.fn().mockResolvedValue(undefined),
  sendTelegramAlert: jest.fn().mockResolvedValue(undefined),
}));

import { maybeAlertCap } from '@/lib/billing/spendCaps/spendAlerts';

type Resp = { data: unknown; error: unknown };
const responses: Resp[] = [];
const inserted: unknown[] = [];
const updates: Array<Record<string, unknown>> = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }
function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  ['select', 'eq'].forEach((m) => { chain[m] = () => chain; });
  chain.maybeSingle = async () => consume();
  chain.insert = async (row: unknown) => { inserted.push(Array.isArray(row) ? row[0] : row); return { data: null, error: null }; };
  chain.update = (payload: Record<string, unknown>) => { updates.push(payload); return chain; };
  chain.upsert = async (payload: Record<string, unknown>) => { updates.push(payload); return { data: null, error: null }; };
  chain.then = (f: (value: Resp) => unknown, r: (reason?: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f, r);
  return chain;
}
const admin = { from: jest.fn(() => makeChain()) } as unknown as SupabaseClient;
const today = () => new Date().toISOString().slice(0, 10);

describe('maybeAlertCap', () => {
  beforeEach(() => { responses.length = 0; inserted.length = 0; updates.length = 0; jest.clearAllMocks(); });

  it('daily_cap: inserts a notification with REAL columns + sets budget_warned_on', async () => {
    pushDb({ budget_warned_on: null });
    await maybeAlertCap(admin, 't1', 'daily_cap');
    expect(inserted).toHaveLength(1);
    // Guard against the schema-mismatch bug: notifications has title/message/meta/read,
    // NOT type/body/metadata.
    const row = inserted[0];
    expect(row).toEqual(expect.objectContaining({ tenant_id: 't1', title: expect.any(String), message: expect.any(String), meta: expect.any(Object) }));
    expect(row).not.toHaveProperty('body');
    expect(row).not.toHaveProperty('metadata');
    expect(row).not.toHaveProperty('type');
    expect(updates.some((u) => 'budget_warned_on' in u)).toBe(true);
  });

  it('daily_cap: does NOT re-alert when already warned today', async () => {
    pushDb({ budget_warned_on: today() });
    await maybeAlertCap(admin, 't1', 'daily_cap');
    expect(inserted).toHaveLength(0);
  });

  it('velocity_cap: logs only, never inserts an owner notification', async () => {
    await maybeAlertCap(admin, 't1', 'velocity_cap');
    expect(inserted).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
