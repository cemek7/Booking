import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
const mockResolve = jest.fn();
const mockCreate = jest.fn();
const mockFetch = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/paystack', () => ({
  resolveBankAccount: (...a: unknown[]) => mockResolve(...a),
  createSubaccount: (...a: unknown[]) => mockCreate(...a),
  fetchSubaccount: (...a: unknown[]) => mockFetch(...a),
  updateSubaccount: (...a: unknown[]) => mockUpdate(...a),
}));
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({ sendErrorAlert: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({ logRequest: jest.fn(), logError: jest.fn(), warn: jest.fn() })),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { GET, POST, PUT } from '@/app/api/payments/subaccounts/route';

const ACCOUNT_NUMBER = '0123456789';
const POLICY_ROW = { code: 'pilot_ngn_v1', version: 1, platform_fee_basis_points: 100, platform_fee_cap_minor: 200000 };

let role = 'owner';
let policyMissing = false;
let accountRow: Record<string, unknown> | null = null;
let writes: Array<{ op: string; table: string; payload: unknown }> = [];

function adminMock() {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'usr_1', email: 'o@test.com' } }, error: null }) },
    from: jest.fn((table: string) => {
      const final = () => {
        if (table === 'tenant_users') return { data: { tenant_id: 'ten_1', role }, error: null };
        if (table === 'payment_fee_policies') return { data: policyMissing ? null : POLICY_ROW, error: null };
        if (table === 'tenant_payment_accounts') return { data: accountRow, error: null };
        if (table === 'tenants') return { data: { name: 'Acme' }, error: null };
        return { data: null, error: null };
      };
      const chain: Record<string, unknown> = {};
      ['select', 'eq', 'neq'].forEach((m) => { chain[m] = () => chain; });
      chain.maybeSingle = async () => final();
      chain.single = async () => final();
      chain.upsert = (payload: unknown) => { writes.push({ op: 'upsert', table, payload }); return Promise.resolve({ data: null, error: null }); };
      chain.update = (payload: unknown) => { writes.push({ op: 'update', table, payload }); return chain; };
      chain.then = (f: (v: unknown) => unknown, r: (e?: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f, r);
      return chain;
    }),
  };
}

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost:3000/api/payments/subaccounts', {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', 'x-tenant-id': 'ten_1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const validBody = {
  businessName: 'Acme', settlementBank: '058', accountNumber: ACCOUNT_NUMBER,
  primaryContactEmail: 'o@test.com', acceptPolicy: { code: 'pilot_ngn_v1', version: 1 },
};
const sub = (over: Record<string, unknown> = {}) => ({
  subaccountCode: 'ACCT_1', businessName: 'Acme', settlementBank: 'Guaranty Trust Bank',
  accountNumber: ACCOUNT_NUMBER, percentageCharge: 0, primaryContactEmail: 'o@test.com', ...over,
});

describe('/api/payments/subaccounts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    role = 'owner';
    policyMissing = false;
    accountRow = null;
    writes = [];
    (createSupabaseAdminClient as jest.Mock).mockImplementation(() => adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue({ from: jest.fn() });
    mockResolve.mockResolvedValue({ success: true, account: { accountName: 'ACME LTD', accountNumber: ACCOUNT_NUMBER } });
    mockCreate.mockResolvedValue({ success: true, subaccount: sub() });
    mockUpdate.mockResolvedValue({ success: true, subaccount: sub() });
    mockFetch.mockResolvedValue({ success: true, subaccount: sub() });
  });

  it('GET with no account returns configured:false, policy and NGN 10,000 example', async () => {
    const res = await GET(req('GET') as unknown as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.configured).toBe(false);
    expect(json.account).toBeNull();
    expect(json.policy).toEqual({ code: 'pilot_ngn_v1', version: 1, basisPoints: 100, capMinor: 200000 });
    expect(json.example).toMatchObject({ amountMinor: 1000000, platformFeeMinor: 10000, tenantGrossMinor: 990000 });
  });

  it('POST without acceptPolicy is 400 and creates nothing', async () => {
    const { acceptPolicy: _a, ...rest } = validBody;
    const res = await POST(req('POST', rest) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('POST with a stale policy version is 409', async () => {
    const res = await POST(req('POST', { ...validBody, acceptPolicy: { code: 'pilot_ngn_v1', version: 2 } }) as unknown as NextRequest);
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('POST rejects an odd bank code or account number before any Paystack call', async () => {
    const a = await POST(req('POST', { ...validBody, settlementBank: '058&x=1' }) as unknown as NextRequest);
    const b = await POST(req('POST', { ...validBody, accountNumber: '12345' }) as unknown as NextRequest);
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('POST happy path verifies, creates at 0%, fetches back and stores last4 only', async () => {
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(ACCOUNT_NUMBER, '058');
    expect(mockResolve.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ percentageCharge: 0 }));
    expect(mockFetch).toHaveBeenCalledWith('ACCT_1');
    const upsert = writes.find((w) => w.op === 'upsert' && w.table === 'tenant_payment_accounts');
    expect(upsert?.payload).toMatchObject({
      status: 'active', subaccount_code: 'ACCT_1', account_last4: '6789', account_name: 'ACME LTD', accepted_by: 'usr_1',
    });
    expect((upsert?.payload as Record<string, unknown>).accepted_at).toEqual(expect.any(String));
    expect(JSON.stringify(writes)).not.toContain(ACCOUNT_NUMBER);
    expect(JSON.stringify(json)).not.toContain(ACCOUNT_NUMBER);
    expect(json.account).toEqual({ bankCode: '058', accountLast4: '6789', accountName: 'ACME LTD' });
  });

  it('POST where Paystack stored a non-zero percentage saves invalid and returns 502', async () => {
    mockFetch.mockResolvedValue({ success: true, subaccount: sub({ percentageCharge: 5 }) });
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    expect(res.status).toBe(502);
    const upsert = writes.find((w) => w.op === 'upsert');
    expect((upsert?.payload as Record<string, unknown>).status).toBe('invalid');
    expect(writes.some((w) => JSON.stringify(w.payload).includes('"active"'))).toBe(false);
    expect(JSON.stringify(await res.json())).not.toContain(ACCOUNT_NUMBER);
  });

  it('POST when already active is 409', async () => {
    accountRow = { status: 'active', subaccount_code: 'ACCT_1' };
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('PUT sets pending first, then active only after fetch-back matches', async () => {
    accountRow = { status: 'active', subaccount_code: 'ACCT_1' };
    const { businessName: _b, ...putBody } = validBody;
    const res = await PUT(req('PUT', putBody) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('ACCT_1', expect.objectContaining({ percentageCharge: 0 }));
    const pending = writes.findIndex((w) => w.op === 'update' && (w.payload as Record<string, unknown>).status === 'pending');
    const active = writes.findIndex((w) => w.op === 'upsert' && (w.payload as Record<string, unknown>).status === 'active');
    expect(pending).toBeGreaterThanOrEqual(0);
    expect(active).toBeGreaterThan(pending);
    expect(JSON.stringify(writes)).not.toContain(ACCOUNT_NUMBER);
  });

  it('PUT without an existing account is 400', async () => {
    const { businessName: _b, ...putBody } = validBody;
    const res = await PUT(req('PUT', putBody) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('non-owner is 403', async () => {
    role = 'manager';
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('POST with percentageCharge null is saved invalid (502)', async () => {
    mockFetch.mockResolvedValue({ success: true, subaccount: sub({ percentageCharge: null }) });
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    expect(res.status).toBe(502);
    expect((writes.find((w) => w.op === 'upsert')?.payload as Record<string, unknown>).status).toBe('invalid');
  });

  it('POST with an account number mismatch is saved invalid (502) without leaking numbers', async () => {
    mockFetch.mockResolvedValue({ success: true, subaccount: sub({ accountNumber: '9999996789' }) });
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    expect(res.status).toBe(502);
    expect((writes.find((w) => w.op === 'upsert')?.payload as Record<string, unknown>).status).toBe('invalid');
    expect(JSON.stringify(writes)).not.toContain(ACCOUNT_NUMBER);
  });

  it.each(['POST', 'PUT'])('%s on a suspended account is 409 ACCOUNT_SUSPENDED with no Paystack call', async (method) => {
    accountRow = { status: 'suspended', subaccount_code: 'ACCT_1' };
    const { businessName: _b, ...putBody } = validBody;
    const res = await (method === 'POST' ? POST : PUT)(req(method, method === 'POST' ? validBody : putBody) as unknown as NextRequest);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    for (const m of [mockResolve, mockCreate, mockUpdate, mockFetch]) expect(m).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('POST on an invalid row with a code updates the existing subaccount instead of creating', async () => {
    accountRow = { status: 'invalid', subaccount_code: 'ACCT_OLD' };
    mockUpdate.mockResolvedValue({ success: true, subaccount: sub({ subaccountCode: 'ACCT_OLD' }) });
    mockFetch.mockResolvedValue({ success: true, subaccount: sub({ subaccountCode: 'ACCT_OLD' }) });
    const res = await POST(req('POST', validBody) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('ACCT_OLD', expect.objectContaining({ percentageCharge: 0 }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('PUT with a bank that fails to resolve is 400 and leaves the row untouched', async () => {
    accountRow = { status: 'active', subaccount_code: 'ACCT_1' };
    mockResolve.mockResolvedValue({ success: false, error: 'nope' });
    const { businessName: _b, ...putBody } = validBody;
    const res = await PUT(req('PUT', putBody) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT'])('%s with a missing policy row errors before any Paystack call', async (method) => {
    policyMissing = true;
    accountRow = { status: 'active', subaccount_code: 'ACCT_1' };
    const { businessName: _b, ...putBody } = validBody;
    const res = await (method === 'POST' ? POST : PUT)(req(method, method === 'POST' ? validBody : putBody) as unknown as NextRequest);
    expect(res.status).toBeGreaterThanOrEqual(500);
    for (const m of [mockResolve, mockCreate, mockUpdate, mockFetch]) expect(m).not.toHaveBeenCalled();
  });
});
