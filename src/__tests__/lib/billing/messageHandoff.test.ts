import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const sendTextMessage = jest.fn() as jest.Mock<() => Promise<unknown>>;
jest.mock('@/lib/whatsapp/providers/unmetered', () => ({
  getTenantWhatsAppProviderClientUnmetered: jest.fn(async () => ({ sendTextMessage })),
}));
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo: jest.fn(async () => undefined),
}));

import { triggerWalletHandoff } from '@/lib/billing/messageHandoff';

// ── queue-based supabase mock ────────────────────────────────────────────────
// Same harness as messageWallet.test.ts (queue of responses, plus insert/update
// recording). The harness never introspects query filters to decide what to
// return — tests assert on what the code does with the rows the mock hands back
// and on the shape of its writes — but it does *record* .eq() filters so a test
// can pin tenant scoping. consume() yields `{ data: null, error: null }` once
// the queue is empty, so incidental extra reads/writes do not need a queued
// response.
type Resp = { data: unknown; error: unknown } | { __err: true };
type QueryResp = { data: unknown; error: unknown };
type FluentMethod = (...args: unknown[]) => MockChain;
type MockChain = {
  select: FluentMethod;
  eq: (column: string, value: unknown) => MockChain;
  neq: FluentMethod;
  gt: FluentMethod;
  gte: FluentMethod;
  lt: FluentMethod;
  not: FluentMethod;
  is: FluentMethod;
  order: FluentMethod;
  in: FluentMethod;
  limit: FluentMethod;
  insert: (row: Record<string, unknown>) => MockChain;
  update: (row: Record<string, unknown>) => MockChain;
  upsert: (row: Record<string, unknown>) => MockChain;
  delete: FluentMethod;
  maybeSingle: () => Promise<QueryResp>;
  single: () => Promise<QueryResp>;
  then: PromiseLike<QueryResp>['then'];
};
type MockClient = {
  from: (table: string) => MockChain;
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResp>;
};
type Write = { table: string; row: Record<string, unknown>; filters: Array<[string, unknown]> };

const responses: Resp[] = [];
const rpcResponses: Resp[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inserts: Write[] = [];
const updates: Write[] = [];
const upserts: Write[] = [];

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
  // Filled by .eq() calls, which land *after* .update()/.upsert() in a fluent
  // chain — recorded by reference so the write entry sees them.
  const filters: Array<[string, unknown]> = [];
  const passthrough: Array<keyof Pick<MockChain, 'select' | 'neq' | 'gt' | 'gte' | 'lt' | 'not' | 'is' | 'order' | 'in' | 'limit' | 'delete'>> =
    ['select', 'neq', 'gt', 'gte', 'lt', 'not', 'is', 'order', 'in', 'limit', 'delete'];
  passthrough.forEach((method) => { chain[method] = () => chain; });
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.insert = (row: Record<string, unknown>) => {
    inserts.push({ table, row, filters });
    return chain;
  };
  chain.update = (row: Record<string, unknown>) => {
    updates.push({ table, row, filters });
    return chain;
  };
  chain.upsert = (row: Record<string, unknown>) => {
    upserts.push({ table, row, filters });
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

const providerMod = jest.requireMock('@/lib/whatsapp/providers/unmetered') as {
  getTenantWhatsAppProviderClientUnmetered: jest.Mock<() => Promise<unknown>>;
};
const telegramMod = jest.requireMock('@/lib/monitoring/telegramAlert') as {
  sendTelegramInfo: jest.Mock<() => Promise<unknown>>;
};

const HOUR_MS = 60 * 60 * 1000;
const today = new Date().toISOString().slice(0, 10);
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();

/** chats lookup → opt-out check → wallet markers → metadata re-read → stamp update. */
function seedSendPath(options: {
  metadata?: Record<string, unknown>;
  wallet?: Record<string, unknown> | null;
  stampRows?: unknown;
  optedOutAt?: string | null;
} = {}) {
  const metadata = options.metadata ?? {};
  pushDb({ id: 'chat-1', metadata });
  pushDb({ opted_out_at: options.optedOutAt ?? null, last_inbound_at: hoursAgo(1) });
  pushDb(options.wallet ?? null);
  pushDb({ id: 'chat-1', metadata });
  pushDb(options.stampRows ?? [{ id: 'chat-1' }]);
}

beforeEach(() => {
  responses.length = 0;
  rpcResponses.length = 0;
  rpcCalls.length = 0;
  inserts.length = 0;
  updates.length = 0;
  upserts.length = 0;
});

describe('triggerWalletHandoff', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends once and stamps the conversation', async () => {
    seedSendPath();
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);

    // RECURSION HAZARD guard, pinned on purpose rather than by accident of the
    // mock's shape: the handoff must resolve the *unmetered* client, because
    // the metered one re-enters reserveOutboundMessage and loops.
    expect(providerMod.getTenantWhatsAppProviderClientUnmetered).toHaveBeenCalledWith('t1');

    // Stamped on chats.metadata — this is the once-per-conversation guard.
    const stamp = updates.find((u) => u.table === 'chats');
    expect(stamp).toBeDefined();
    const metadata = stamp!.row.metadata as Record<string, unknown>;
    expect(typeof metadata.wallet_handoff_at).toBe('string');
    // Tenant-scoped, as every other chats write in this repo is.
    expect(stamp!.filters).toContainEqual(['tenant_id', 't1']);

    // Recorded in the thread: staff taking over need to see what the customer
    // was already promised, and this send bypasses the normal reply path that
    // would otherwise persist it.
    const thread = inserts.find((i) => i.table === 'messages');
    expect(thread).toBeDefined();
    expect(thread!.row).toMatchObject({
      tenant_id: 't1', chat_id: 'chat-1', direction: 'outbound', to_number: '2348012345678',
    });

    // Owner alert, in the notifications shape this repo actually has
    // (tenant_id, title, message, meta, read — no type/body/metadata).
    const alert = inserts.find((i) => i.table === 'notifications');
    expect(alert).toBeDefined();
    expect(alert!.row).toMatchObject({ tenant_id: 't1', read: false });
    expect(typeof alert!.row.title).toBe('string');
    expect(typeof alert!.row.message).toBe('string');
  });

  it('does not send twice for the same conversation', async () => {
    pushDb({ id: 'chat-1', metadata: { wallet_handoff_at: hoursAgo(1) } });
    pushDb([]); // ai_wallet_ledger: no credit since the stamp
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'already_handed_off' });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('re-arms once the stamp is older than the re-arm window', async () => {
    // chats is UNIQUE on (tenant_id, customer_phone), so a permanent stamp
    // would silence this customer for the life of the relationship.
    seedSendPath({ metadata: { wallet_handoff_at: hoursAgo(25) } });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('re-arms when the wallet was credited after the stamp, inside the window', async () => {
    // Exhaust 09:00 → top up 10:00 → re-exhaust 15:00: the stamp is only six
    // hours old, so the clock alone would keep this customer silent.
    pushDb({ id: 'chat-1', metadata: { wallet_handoff_at: hoursAgo(6) } });
    pushDb({ opted_out_at: null, last_inbound_at: hoursAgo(1) });
    pushDb([{ id: 'ledger-1' }]); // ai_wallet_ledger: a topup landed since
    pushDb(null); // wallet markers
    pushDb({ id: 'chat-1', metadata: { wallet_handoff_at: hoursAgo(6) } });
    pushDb([{ id: 'chat-1' }]);
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('treats an unparseable stamp as stale rather than as recent', async () => {
    // Date.parse(garbage) is NaN and every NaN comparison is false, so a naive
    // freshness check reads garbage as "just stamped" and silences the
    // conversation forever — the bug surviving its own fix.
    seedSendPath({ metadata: { wallet_handoff_at: 'not-a-date' } });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
  });

  it('refuses to send an instagram handoff over the whatsapp adapter', async () => {
    // The IG webhook upserts chats with customer_phone = <IGSID>, so the chat
    // lookup succeeds and a 17-digit IGSID would be handed to the WhatsApp
    // adapter as a phone number.
    const r = await triggerWalletHandoff(adminAny, 't1', '17841400000000000', 'instagram');
    expect(r).toEqual({ sent: false, reason: 'unsupported_channel' });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(providerMod.getTenantWhatsAppProviderClientUnmetered).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('reports no_provider rather than throwing', async () => {
    providerMod.getTenantWhatsAppProviderClientUnmetered.mockResolvedValueOnce(null);
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb(null);
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'no_provider' });
    expect(updates).toHaveLength(0);
  });

  it('never lets the customer see the tenant billing state', async () => {
    seedSendPath();
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    const text = String(sendTextMessage.mock.calls[0][1]).toLowerCase();
    expect(text).not.toMatch(/wallet|credit|billing|balance|payment|top ?up/);
  });

  it('does not stamp or alert when the send itself fails', async () => {
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb(null);
    sendTextMessage.mockResolvedValue({ success: false, reason: 'provider_down' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it('returns an error result instead of throwing when the chat lookup blows up', async () => {
    pushErr();
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('does not send without an idempotency anchor when the chat row read errors', async () => {
    pushDbErr({ code: '42P01', message: 'boom' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('does not send when there is no chat row to anchor the stamp on', async () => {
    // A missing row is `data: null, error: null` — not an error. Sending anyway
    // would hand off on every single inbound message, which is the loop this
    // module exists to prevent. Do not "fix" this branch into sending.
    pushDb(null);
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'error' });
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('treats a zero-row stamp update as a failure and caps the tenant for the day', async () => {
    // `.update()` without `.select()` reports `error: null` for a zero-row
    // match, so a vanished row or a filtering policy would read as success.
    seedSendPath({ stampRows: [] });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });

    const ceiling = upserts.find((u) => 'message_handoff_unanchored_on' in u.row);
    expect(ceiling).toBeDefined();
    expect(ceiling!.table).toBe('ai_wallets');
    expect(ceiling!.row).toMatchObject({ tenant_id: 't1', message_handoff_unanchored_on: today });
  });

  it('suppresses the handoff while stamping is known to be broken for the tenant', async () => {
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb({ opted_out_at: null, last_inbound_at: hoursAgo(1) });
    pushDb({ message_handoff_unanchored_on: today });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'already_handed_off' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('alerts the owner once per tenant per day, not once per conversation', async () => {
    // One exhaustion refuses a send in every live conversation; without this
    // gate a tenant with 50 open chats gets 50 notifications and 50 pings.
    seedSendPath({ wallet: { message_handoff_warned_on: today } });
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(inserts.filter((i) => i.table === 'notifications')).toHaveLength(0);
    expect(telegramMod.sendTelegramInfo).not.toHaveBeenCalled();
  });

  it('stamps the day marker when it does alert, so the next conversation is quiet', async () => {
    seedSendPath();
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    const marker = upserts.find((u) => 'message_handoff_warned_on' in u.row);
    expect(marker).toBeDefined();
    expect(marker!.row).toMatchObject({ tenant_id: 't1', message_handoff_warned_on: today });
    // Not the spend-cap alerter's column — sharing it would let a spend-cap
    // warning silently suppress a wallet-handoff alert.
    expect(marker!.row).not.toHaveProperty('budget_warned_on');
  });

  it('does not turn a delivered handoff into a reported failure when the alert fails', async () => {
    seedSendPath();
    pushErr(); // notifications insert blows up
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });
});

describe('triggerWalletHandoff — opt-out compliance', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('refuses to hand off to a customer who has unsubscribed', async () => {
    // This send bypasses sendGovernedInitiated, so this guard is the only
    // opt-out check on the path. The sharpest case is a STOP into an exhausted
    // wallet: without this the customer is told a human will follow up moments
    // after asking not to be contacted.
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb({ opted_out_at: '2026-08-30T00:00:00Z', last_inbound_at: hoursAgo(1) });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'opted_out' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('still hands off when the opt-out lookup itself fails', async () => {
    // A failed lookup must not silently suppress a handoff the tenant relies on.
    pushDb({ id: 'chat-1', metadata: {} });
    pushDbErr({ message: 'boom' });
    pushDb(null);
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb([{ id: 'chat-1' }]);
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
  });
});

describe('triggerWalletHandoff — 24h service window', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('does not send free-form text outside the service window', async () => {
    // Meta only permits free-form messages within 24h of the customer's last
    // inbound. This held implicitly before — a handoff needs a chats row, and
    // only inbound conversations have one — but that was a property of the call
    // graph, not a check.
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb({ opted_out_at: null, last_inbound_at: hoursAgo(25) });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: false, reason: 'outside_service_window' });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('sends when the last inbound is recent', async () => {
    seedSendPath();
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
  });

  it('sends when there is no conversation row to judge the window by', async () => {
    // Fail toward sending: a missing row is not evidence the window has closed.
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb(null);
    pushDb(null);
    pushDb({ id: 'chat-1', metadata: {} });
    pushDb([{ id: 'chat-1' }]);
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });
    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });
  });
});

describe('triggerWalletHandoff — owner reaches the owner', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('messages the owner on WhatsApp through the unmetered client', async () => {
    // Before this the owner got a dashboard row they had to already be logged
    // in to see. The owner send MUST be unmetered: a metered one would reserve
    // against the very wallet that is empty, be refused, and fire another
    // customer handoff.
    pushDb({ id: 'chat-1', metadata: {} });                       // chats
    pushDb({ opted_out_at: null, last_inbound_at: hoursAgo(1) }); // guards
    pushDb(null);                                                 // wallet markers
    pushDb({ id: 'chat-1', metadata: {} });                       // metadata re-read
    pushDb([{ id: 'chat-1' }]);                                   // stamp update
    pushDb(null);                                                 // messages insert
    pushDb(null);                                                 // notifications insert
    pushDb({ email: 'owner@example.com', phone: '2349000000000' }); // owner lookup
    sendTextMessage.mockResolvedValue({ success: true, messageId: 'wamid.H' });

    const r = await triggerWalletHandoff(adminAny, 't1', '2348012345678', 'whatsapp');
    expect(r).toEqual({ sent: true, reason: 'sent' });

    // Two sends: the customer handoff and the owner alert.
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    expect(sendTextMessage.mock.calls[0][0]).toBe('2348012345678');
    expect(sendTextMessage.mock.calls[1][0]).toBe('2349000000000');
    expect(providerMod.getTenantWhatsAppProviderClientUnmetered).toHaveBeenCalledWith('t1');
  });
});
