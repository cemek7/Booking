import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const sendTextMessage = jest.fn() as jest.Mock<() => Promise<unknown>>;
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClientUnmetered: jest.fn(async () => ({ sendTextMessage })),
}));
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo: jest.fn(async () => undefined),
}));

import { triggerWalletHandoff } from '@/lib/billing/messageHandoff';

// ── queue-based supabase mock ────────────────────────────────────────────────
// Same harness as messageWallet.test.ts (queue of responses, plus insert/update
// recording). The harness never introspects query filters — tests assert on what
// the code does with the rows the mock hands back and on the shape of its writes.
// consume() yields `{ data: null, error: null }` once the queue is empty, so
// incidental extra reads/writes do not need a queued response.
type Resp = { data: unknown; error: unknown } | { __err: true };
type QueryResp = { data: unknown; error: unknown };
type FluentMethod = (...args: unknown[]) => MockChain;
type MockChain = {
  select: FluentMethod;
  eq: FluentMethod;
  neq: FluentMethod;
  gte: FluentMethod;
  lt: FluentMethod;
  not: FluentMethod;
  is: FluentMethod;
  order: FluentMethod;
  in: FluentMethod;
  insert: (row: Record<string, unknown>) => MockChain;
  update: (row: Record<string, unknown>) => MockChain;
  delete: FluentMethod;
  maybeSingle: () => Promise<QueryResp>;
  single: () => Promise<QueryResp>;
  then: PromiseLike<QueryResp>['then'];
};
type MockClient = {
  from: (table: string) => MockChain;
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResp>;
};

const responses: Resp[] = [];
const rpcResponses: Resp[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const updates: Array<{ table: string; row: Record<string, unknown> }> = [];

function pushDb(data: unknown) {
  responses.push({ data, error: null });
}
function pushDbErr(error: unknown) {
  responses.push({ data: null, error });
}
function pushErr() {
  responses.push({ __err: true });
}

function consume(queue: Resp[]): QueryResp {
  const r = queue.shift() ?? { data: null, error: null };
  if ((r as { __err?: true }).__err) throw new Error('mock query error');
  return r as { data: unknown; error: unknown };
}

function makeChain(table: string): MockChain {
  const chain = {} as MockChain;
  const passthrough: Array<keyof Pick<MockChain, 'select' | 'eq' | 'neq' | 'gte' | 'lt' | 'not' | 'is' | 'order' | 'in' | 'delete'>> =
    ['select', 'eq', 'neq', 'gte', 'lt', 'not', 'is', 'order', 'in', 'delete'];
  passthrough.forEach((method) => { chain[method] = () => chain; });
  chain.insert = (row: Record<string, unknown>) => {
    inserts.push({ table, row });
    return chain;
  };
  chain.update = (row: Record<string, unknown>) => {
    updates.push({ table, row });
    return chain;
  };
  chain.maybeSingle = async () => consume(responses);
  chain.single = async () => consume(responses);
  chain.then = (onfulfilled, onrejected) => Promise.resolve().then(() => consume(responses)).then(onfulfilled, onrejected);
  return chain;
}

const admin: MockClient = {
  from: (table: string) => makeChain(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return consume(rpcResponses);
  },
};
const adminAny = admin as unknown as Parameters<typeof triggerWalletHandoff>[0];

beforeEach(() => {
  responses.length = 0;
  rpcResponses.length = 0;
  rpcCalls.length = 0;
  inserts.length = 0;
  updates.length = 0;
});

describe('triggerWalletHandoff', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends once and stamps the conversation', async () => {
    pushDb({ id: 'chat-1', metadata: {} });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    pushDb({ id: 'chat-1' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);

    // Stamped on chats.metadata — this is the once-per-conversation guard.
    const stamp = updates.find((u) => u.table === 'chats');
    expect(stamp).toBeDefined();
    const metadata = stamp!.row.metadata as Record<string, unknown>;
    expect(typeof metadata.wallet_handoff_at).toBe('string');

    // Owner alert, in the notifications shape this repo actually has
    // (tenant_id, title, message, meta, read — no type/body/metadata).
    const alert = inserts.find((i) => i.table === 'notifications');
    expect(alert).toBeDefined();
    expect(alert!.row).toMatchObject({ tenant_id: 't1', read: false });
    expect(typeof alert!.row.title).toBe('string');
    expect(typeof alert!.row.message).toBe('string');
  });

  it('does not send twice for the same conversation', async () => {
    pushDb({ id: 'chat-1', metadata: { wallet_handoff_at: '2026-10-01T00:00:00Z' } });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'already_handed_off' });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('reports no_provider rather than throwing', async () => {
    const mod = jest.requireMock('@/lib/whatsapp/providers/providerSelection') as {
      getTenantWhatsAppProviderClientUnmetered: jest.Mock<() => Promise<unknown>>;
    };
    mod.getTenantWhatsAppProviderClientUnmetered.mockResolvedValueOnce(null);
    pushDb({ id: 'chat-1', metadata: {} });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'no_provider' });
    expect(updates).toHaveLength(0);
  });

  it('never lets the customer see the tenant billing state', async () => {
    pushDb({ id: 'chat-1', metadata: {} });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    const text = String(sendTextMessage.mock.calls[0][1]).toLowerCase();
    expect(text).not.toMatch(/wallet|credit|billing|balance|payment|top ?up/);
  });

  it('does not stamp or alert when the send itself fails', async () => {
    pushDb({ id: 'chat-1', metadata: {} });
    sendTextMessage.mockResolvedValue({ success: false, reason: 'provider_down' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('returns an error result instead of throwing when the chat lookup blows up', async () => {
    pushErr();
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('does not send without an idempotency anchor when the chat row read errors', async () => {
    pushDbErr({ code: '42P01', message: 'boom' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
