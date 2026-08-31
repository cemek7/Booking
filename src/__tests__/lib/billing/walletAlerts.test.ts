import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const sendTransactionalEmail = jest.fn() as jest.Mock<() => Promise<{ success: boolean }>>;
jest.mock('@/lib/integrations/email-service', () => ({ sendTransactionalEmail }));

const sendTextMessage = jest.fn() as jest.Mock<() => Promise<unknown>>;
const getTenantWhatsAppProviderClientUnmetered = jest.fn(async () => ({ sendTextMessage }));
jest.mock('@/lib/whatsapp/providers/unmetered', () => ({
  getTenantWhatsAppProviderClientUnmetered,
}));

import { deliverWalletAlert, resolveTenantOwner } from '@/lib/billing/walletAlerts';

// ── queue-based supabase mock (same pattern as messageHandoff.test.ts) ───────
type Resp = { data: unknown; error: unknown };
type Chain = Record<string, (...a: unknown[]) => Chain> & { then: PromiseLike<Resp>['then'] };
const responses: Resp[] = [];
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function pushDbErr(error: unknown) { responses.push({ data: null, error }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }

function makeChain(table: string): Chain {
  const chain = {} as Chain;
  ['select', 'eq', 'neq', 'limit', 'order', 'is', 'not'].forEach((m) => { chain[m] = () => chain; });
  chain.insert = (row: Record<string, unknown>) => {
    inserts.push({ table, row: row as Record<string, unknown> });
    return chain;
  };
  chain.maybeSingle = (async () => consume()) as never;
  chain.single = (async () => consume()) as never;
  chain.then = (onfulfilled, onrejected) =>
    Promise.resolve().then(() => consume()).then(onfulfilled, onrejected);
  return chain;
}
const admin = { from: (t: string) => makeChain(t) } as never;

beforeEach(() => {
  responses.length = 0;
  inserts.length = 0;
  jest.clearAllMocks();
  sendTransactionalEmail.mockResolvedValue({ success: true });
  getTenantWhatsAppProviderClientUnmetered.mockResolvedValue({ sendTextMessage });
});

describe('resolveTenantOwner', () => {
  it('returns the owner contact details', async () => {
    pushDb([{ email: 'owner@example.com', phone: '2348012345678' }]);
    await expect(resolveTenantOwner(admin, 't1')).resolves.toEqual({
      email: 'owner@example.com', phone: '2348012345678',
    });
  });

  it('returns null rather than throwing when the lookup fails', async () => {
    pushDbErr({ message: 'boom' });
    await expect(resolveTenantOwner(admin, 't1')).resolves.toBeNull();
  });

  it('returns null when the tenant has no owner row', async () => {
    pushDb([]);
    await expect(resolveTenantOwner(admin, 't1')).resolves.toBeNull();
  });

  it('survives duplicate owner rows and picks the contactable one', async () => {
    // tenant_users has a PK on id and no unique constraint on (tenant_id, role),
    // so two owner rows are structurally possible. maybeSingle() would error on
    // that and the tenant would silently get no alert at all.
    pushDb([
      { email: null, phone: null },
      { email: 'owner@example.com', phone: '2348012345678' },
    ]);
    await expect(resolveTenantOwner(admin, 't1')).resolves.toEqual({
      email: 'owner@example.com', phone: '2348012345678',
    });
  });

  it('falls back to a phone-only owner', async () => {
    // WhatsApp-native tenants are onboarded phone-first: ownerOnboarding.ts
    // inserts the owner row with user_id AND email both NULL.
    pushDb([{ email: null, phone: '2348012345678' }]);
    await expect(resolveTenantOwner(admin, 't1')).resolves.toEqual({
      email: null, phone: '2348012345678',
    });
  });
});

describe('deliverWalletAlert', () => {
  const alert = {
    tenantId: 't1',
    kind: 'wallet_handoff' as const,
    title: 'Message wallet empty',
    message: 'Top up to resume automated replies.',
  };

  /** notifications insert resolves first, then the owner lookup. */
  function seedOwner(owner: unknown = [{ email: 'owner@example.com', phone: '2348012345678' }]) {
    pushDb(null);
    pushDb(owner);
  }

  it('writes the in-app row and emails the owner', async () => {
    seedOwner();
    await deliverWalletAlert(admin, alert);

    const row = inserts.find((i) => i.table === 'notifications');
    expect(row).toBeDefined();
    expect(row!.row).toMatchObject({ tenant_id: 't1', read: false });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const opts = sendTransactionalEmail.mock.calls[0][0] as { to: string; marketing?: boolean };
    expect(opts.to).toBe('owner@example.com');
    // Operational, not marketing: it must never be suppressed by a marketing opt-out.
    expect(opts.marketing).not.toBe(true);
  });

  it('does not message the owner over WhatsApp unless asked', async () => {
    seedOwner();
    await deliverWalletAlert(admin, alert);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('uses the UNMETERED client for the owner WhatsApp alert', async () => {
    // The metered client would reserve credit against the very wallet that is
    // empty, be refused, and fire a customer handoff — so the alert would fail
    // at exactly the moment it is needed, and would recurse.
    seedOwner();
    await deliverWalletAlert(admin, { ...alert, whatsappOwner: true });
    expect(getTenantWhatsAppProviderClientUnmetered).toHaveBeenCalledWith('t1');
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('still writes the in-app row when the owner cannot be resolved', async () => {
    pushDb(null);
    pushDb([]);
    await deliverWalletAlert(admin, alert);
    expect(inserts.find((i) => i.table === 'notifications')).toBeDefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('one failing channel does not stop the others', async () => {
    seedOwner();
    sendTransactionalEmail.mockRejectedValueOnce(new Error('smtp down'));
    await expect(
      deliverWalletAlert(admin, { ...alert, whatsappOwner: true }),
    ).resolves.toBeUndefined();
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('never throws, so an alert failure cannot break the caller', async () => {
    pushDbErr({ message: 'boom' });
    await expect(deliverWalletAlert(admin, alert)).resolves.toBeUndefined();
  });
});

describe('deliverWalletAlert — WhatsApp-native owners', () => {
  const lowBalance = {
    tenantId: 't1',
    kind: 'wallet_low_balance' as const,
    title: 'Message wallet running low',
    message: 'Top up to keep automated replies running.',
  };

  it('reaches an owner with no email over WhatsApp, even for an email-only alert', async () => {
    // The low-balance warning is the one that actually helps — it fires while
    // the tenant can still act. Sending it by email alone would deliver nothing
    // at all to phone-first WhatsApp-native tenants, which is the segment Booka
    // onboards over WhatsApp in the first place.
    pushDb(null);
    pushDb([{ email: null, phone: '2349000000000' }]);
    await deliverWalletAlert(admin, lowBalance);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(getTenantWhatsAppProviderClientUnmetered).toHaveBeenCalledWith('t1');
  });

  it('does not spend a WhatsApp message when the owner has an email', async () => {
    pushDb(null);
    pushDb([{ email: 'owner@example.com', phone: '2349000000000' }]);
    await deliverWalletAlert(admin, lowBalance);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
