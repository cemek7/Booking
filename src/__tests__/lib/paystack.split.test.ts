import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
jest.mock('@/lib/fetchWithTimeout', () => ({ fetchWithTimeout: (...a: unknown[]) => mockFetch(...a) }));

import { initializeSplitTransaction, verifyTransaction } from '@/lib/paystack';

const ok = (body: unknown) => ({ json: async () => body });

describe('initializeSplitTransaction', () => {
  beforeEach(() => { mockFetch.mockReset(); process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'; });

  it('sends the exact split contract in minor units', async () => {
    mockFetch.mockResolvedValue(ok({ status: true, data: { authorization_url: 'https://checkout/x' } }));
    const r = await initializeSplitTransaction({
      email: 'a@b.co', amountMinor: 500000, reference: 'bk_ref1', currency: 'NGN',
      subaccountCode: 'ACCT_1', transactionChargeMinor: 5000, callbackUrl: 'https://cb', metadata: { k: 1 },
    });
    expect(r).toEqual({ success: true, authorizationUrl: 'https://checkout/x' });
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string; method: string }];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.co', amount: 500000, reference: 'bk_ref1', currency: 'NGN',
      callback_url: 'https://cb', metadata: { k: 1 },
      subaccount: 'ACCT_1', transaction_charge: 5000, bearer: 'subaccount',
    });
  });

  it('returns the provider message on failure', async () => {
    mockFetch.mockResolvedValue(ok({ status: false, message: 'Invalid subaccount' }));
    const r = await initializeSplitTransaction({
      email: 'a@b.co', amountMinor: 100, reference: 'bk_ref2', currency: 'NGN', subaccountCode: 'ACCT_1', transactionChargeMinor: 1,
    });
    expect(r).toEqual({ success: false, error: 'Invalid subaccount' });
  });
});

describe('verifyTransaction', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps verified fields', async () => {
    mockFetch.mockResolvedValue(ok({ status: true, data: {
      status: 'success', reference: 'bk_ref1', amount: 500000, currency: 'NGN', fees: 7500,
      subaccount: { subaccount_code: 'ACCT_1' },
    } }));
    expect(await verifyTransaction('bk_ref1')).toEqual({ success: true, data: {
      status: 'success', reference: 'bk_ref1', amountMinor: 500000, currency: 'NGN', feesMinor: 7500, subaccountCode: 'ACCT_1',
    } });
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/verify/bk_ref1');
  });

  it('returns null subaccount when Paystack sends an empty object', async () => {
    mockFetch.mockResolvedValue(ok({ status: true, data: { status: 'success', reference: 'r', amount: 1, currency: 'NGN', fees: null, subaccount: {} } }));
    const r = await verifyTransaction('r');
    expect(r.success && r.data.subaccountCode).toBeNull();
  });

  it('fails when the provider says no', async () => {
    mockFetch.mockResolvedValue(ok({ status: false, message: 'Transaction reference not found' }));
    expect(await verifyTransaction('missing')).toEqual({ success: false, error: 'Transaction reference not found' });
  });

  it('url-encodes the reference', async () => {
    mockFetch.mockResolvedValue(ok({ status: false, message: 'x' }));
    await verifyTransaction('a/b');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/verify/a%2Fb');
  });
});
