import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockDeliver = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
jest.mock('@/lib/billing/walletAlerts', () => ({
  deliverWalletAlert: (...a: unknown[]) => mockDeliver(...a),
}));

import {
  findTenantsOwningMetaBilling, buildWarning, runMetaPaymentWatch,
} from '@/lib/billing/metaBillingWatch';

/**
 * Booka's own payment method covers only the shared gateway. A tenant who
 * brought their own number is billed by Meta directly, and nothing in the
 * product raises an error when their messages stop — they just go quiet.
 */

type Row = Record<string, unknown>;
let configRows: Row[] = [];
let notificationRows: Row[] = [];
let configError: unknown = null;
let notificationError: unknown = null;

function makeAdmin() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const result = table === 'whatsapp_configurations'
        ? { data: configError ? null : configRows, error: configError }
        : { data: notificationError ? null : notificationRows, error: notificationError };
      Object.assign(q, {
        select: () => q, eq: () => q, gte: () => q, limit: () => q,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      });
      return q;
    },
  } as never;
}

const NOW = new Date('2026-09-08T00:00:00Z');

beforeEach(() => {
  mockDeliver.mockClear();
  configError = null; notificationError = null;
  notificationRows = [];
  configRows = [];
});

describe('findTenantsOwningMetaBilling', () => {
  it('selects tenants billed directly by Meta', async () => {
    configRows = [
      { tenant_id: 't-client', meta_billing_owner: 'client', meta_connection_source: 'embedded_signup' },
      { tenant_id: 't-booka', meta_billing_owner: 'booka', meta_connection_source: null },
    ];
    const out = await findTenantsOwningMetaBilling(makeAdmin());
    expect(out.map((t) => t.tenantId)).toEqual(['t-client']);
  });

  it('includes a self-connected tenant whose billing owner was never recorded', async () => {
    // meta_billing_owner arrived after the connection flow, so older
    // self-connected tenants can have a null owner and still be billed by Meta.
    configRows = [
      { tenant_id: 't-old', meta_billing_owner: null, meta_connection_source: 'direct' },
    ];
    const out = await findTenantsOwningMetaBilling(makeAdmin());
    expect(out.map((t) => t.tenantId)).toEqual(['t-old']);
  });

  it('excludes shared-gateway tenants with no connection source', async () => {
    configRows = [{ tenant_id: 't-shared', meta_billing_owner: null, meta_connection_source: null }];
    expect(await findTenantsOwningMetaBilling(makeAdmin())).toEqual([]);
  });

  it('returns nothing rather than throwing when the read fails', async () => {
    configError = { message: 'boom' };
    expect(await findTenantsOwningMetaBilling(makeAdmin())).toEqual([]);
  });
});

describe('buildWarning', () => {
  it('counts down before the deadline', () => {
    const w = buildWarning(22);
    expect(w.title).toContain('22 days left');
    expect(w.message).toContain('30 September');
  });

  it('switches to the present tense once it has passed', () => {
    const w = buildWarning(-2);
    expect(w.title).not.toContain('left');
    expect(w.message).toContain('may already be silent');
  });

  it('says "1 day" rather than "1 days"', () => {
    expect(buildWarning(1).title).toContain('1 day left');
  });
});

describe('runMetaPaymentWatch', () => {
  beforeEach(() => {
    configRows = [
      { tenant_id: 't1', meta_billing_owner: 'client', meta_connection_source: 'embedded_signup' },
    ];
  });

  it('reaches the owner over WhatsApp, not just the dashboard', async () => {
    const res = await runMetaPaymentWatch(makeAdmin(), NOW);

    expect(res).toMatchObject({ checked: 1, warned: 1 });
    const alert = mockDeliver.mock.calls[0][1] as Record<string, unknown>;
    // The owners most likely to miss this are the ones who never open the
    // dashboard, so the platform-funded WhatsApp is the point.
    expect(alert.whatsappOwner).toBe(true);
    expect((alert.meta as Record<string, unknown>).kind).toBe('meta_payment_method');
  });

  it('warns each tenant at most once a day', async () => {
    notificationRows = [{ id: 'n1' }];
    const res = await runMetaPaymentWatch(makeAdmin(), NOW);
    expect(res).toMatchObject({ warned: 0, skipped: 1 });
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('skips rather than double-sends when the dedupe check itself fails', async () => {
    // Repeating the warning hourly would train the owner to ignore it.
    notificationError = { message: 'boom' };
    const res = await runMetaPaymentWatch(makeAdmin(), NOW);
    expect(res).toMatchObject({ warned: 0, skipped: 1 });
  });

  it('keeps going when one tenant fails', async () => {
    configRows = [
      { tenant_id: 't1', meta_billing_owner: 'client', meta_connection_source: 'direct' },
      { tenant_id: 't2', meta_billing_owner: 'client', meta_connection_source: 'direct' },
    ];
    mockDeliver.mockRejectedValueOnce(new Error('smtp down'));
    const res = await runMetaPaymentWatch(makeAdmin(), NOW);
    expect(res.warned).toBe(1);
    expect(res.checked).toBe(2);
  });
});
