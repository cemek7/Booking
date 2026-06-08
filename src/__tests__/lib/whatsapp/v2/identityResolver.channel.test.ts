import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Query-shape tracking ──────────────────────────────────────────────────────
// Each chain records every .eq(col, val) call so tests can assert
// which filters were (or were not) applied.

type EqCall = [col: string, val: unknown];

interface SpyChain {
  select: jest.Mock;
  eq: jest.Mock;
  neq: jest.Mock;
  ilike: jest.Mock;
  in: jest.Mock;
  lt: jest.Mock;
  gt: jest.Mock;
  lte: jest.Mock;
  gte: jest.Mock;
  not: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  maybeSingle: jest.Mock;
  /** All .eq(col, val) calls made on this chain, in order. */
  eqCalls: EqCall[];
}

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: DbRow | DbRow[]; error: null }> = [];
function pushList(rows: Array<Record<string, unknown>>) {
  responses.push({ data: rows as DbRow[], error: null });
}
function pushNone() {
  // For .maybeSingle() queries that should return no match
  responses.push({ data: null, error: null });
}

/** Tables queried via .from(table) in each resolveIncoming call, in order. */
let fromCalls: string[] = [];
/** All chains created, indexed by creation order. */
let chains: SpyChain[] = [];

function makeChain(): SpyChain {
  const eqCalls: EqCall[] = [];
  const chain = {} as SpyChain;
  chain.eqCalls = eqCalls;

  (
    ['select', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order'] as const
  ).forEach((m) => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });

  // eq() records each call so tests can assert on filter arguments
  chain.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });

  chain.limit = jest.fn().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? { data: [], error: null })
  );
  chain.maybeSingle = jest.fn().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? { data: null, error: null })
  );

  chains.push(chain);
  return chain;
}

const mockClient = {
  from: jest.fn().mockImplementation((table: string) => {
    fromCalls.push(table);
    return makeChain();
  }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}));

import { resolveIncoming } from '@/lib/whatsapp/v2/identityResolver';

beforeEach(() => {
  responses.length = 0;
  fromCalls = [];
  chains = [];
  mockClient.from.mockClear();
  // Re-set implementation after mockClear
  mockClient.from.mockImplementation((table: string) => {
    fromCalls.push(table);
    return makeChain();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Instagram tests
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveIncoming Instagram', () => {
  it('resolves an existing IG conversation via channel+external_id filters (never phone_number)', async () => {
    // Only one DB query should happen: the existing-conversation lookup
    pushList([{ tenant_id: 't9', role: 'customer' }]);

    const r = await resolveIncoming('instagram', 'IGSID_9', 'hi do you have space saturday');

    expect(r.tenantId).toBe('t9');
    expect(r.role).toBe('customer');

    // The conversation lookup must have been on whatsapp_conversations
    expect(fromCalls).toContain('whatsapp_conversations');

    // The chain for that query must have filtered on channel='instagram'
    const convChain = chains[0];
    expect(convChain.eqCalls).toContainEqual(['channel', 'instagram']);
    // …and on external_id='IGSID_9'
    expect(convChain.eqCalls).toContainEqual(['external_id', 'IGSID_9']);

    // phone_number must NEVER appear in any eq() filter
    const allEqCalls = chains.flatMap((c) => c.eqCalls);
    const phoneEq = allEqCalls.find(([col]) => col === 'phone_number');
    expect(phoneEq).toBeUndefined();

    // Only one table should be queried (no staff/tenant lookups for IG)
    expect(fromCalls).toHaveLength(1);
  });

  it('routing codes are WhatsApp-only: IG skips tenants lookup; WhatsApp queries it', async () => {
    // ── Instagram with no existing conversation + routing-code-shaped message ──
    pushList([]); // no existing conversation
    const igResult = await resolveIncoming('instagram', 'IGSID_NEW', 'GLOW12 hello');

    expect(igResult.tenantId).toBeNull();
    expect(igResult.routingCodeFound).toBe(false);

    // IG must NOT have queried the tenants table
    expect(fromCalls).not.toContain('tenants');

    // Reset for the WhatsApp call
    fromCalls = [];
    chains = [];
    mockClient.from.mockClear();
    mockClient.from.mockImplementation((table: string) => {
      fromCalls.push(table);
      return makeChain();
    });

    // ── WhatsApp with no existing conversation + routing code → queries tenants ──
    pushList([]); // no existing conversation (terminates with .limit())
    pushNone();   // resolveByPhone → tenant_users.maybeSingle() → no match
    // tenants routing-code lookup → push a matching tenant so the code path executes
    responses.push({ data: { id: 'tenant-glow', routing_code: 'GLOW12' } as DbRow, error: null });

    const waResult = await resolveIncoming('whatsapp', '+2348000000001', 'GLOW12 hello');

    // WhatsApp DID query tenants for the routing code
    expect(fromCalls).toContain('tenants');
    expect(waResult.routingCodeFound).toBe(true);
    expect(waResult.tenantId).toBe('tenant-glow');
  });
});
