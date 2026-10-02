import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
const mockRefundTenantPayment = jest.fn();
jest.mock('@/lib/payments/tenantRefunds', () => ({
  refundTenantPayment: (...a: unknown[]) => mockRefundTenantPayment(...a),
}));
const mockProcessRefund = jest.fn();
jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ processRefund: (...a: unknown[]) => mockProcessRefund(...a) })),
}));
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({ sendErrorAlert: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({ logRequest: jest.fn(), logError: jest.fn(), warn: jest.fn() })),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { POST } from '@/app/api/payments/refund/route';

let amountMinorOnRow: number | null = 500000;

function adminMock() {
  const chain = (final: unknown): Record<string, unknown> => ({
    select: () => chain(final),
    eq: () => chain(final),
    maybeSingle: async () => final,
    single: async () => final,
  });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'usr_1', email: 'o@test.com' } }, error: null }) },
    from: jest.fn((t: string) => {
      if (t === 'tenant_users') return chain({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null });
      if (t === 'transactions') return chain({ data: { amount_minor: amountMinorOnRow }, error: null });
      return chain({ data: null, error: null });
    }),
  };
}

function req(body: unknown) {
  return new NextRequest('http://localhost:3000/api/payments/refund', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', 'x-tenant-id': 'ten_1' },
    body: JSON.stringify(body),
  });
}

describe('refund route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    amountMinorOnRow = 500000;
    (createSupabaseAdminClient as jest.Mock).mockImplementation(() => adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue({ from: jest.fn() });
  });

  it('settled rows refund in kobo via refundTenantPayment', async () => {
    mockRefundTenantPayment.mockResolvedValue({ ok: true, refundedMinor: 200000, full: false });
    const res = await POST(req({ transactionId: 'tx1', amountMinor: 200000, reason: 'r' }) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(mockRefundTenantPayment).toHaveBeenCalledWith({ tenantId: 'ten_1', transactionId: 'tx1', amountMinor: 200000, reason: 'r' });
    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ refundedMinor: 200000, full: false });
  });

  it('returns 400 when the settled refund is refused', async () => {
    mockRefundTenantPayment.mockResolvedValue({ ok: false, error: 'Refund exceeds the amount paid' });
    const res = await POST(req({ transactionId: 'tx1', amountMinor: 900000 }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it('rejects non-integer amountMinor', async () => {
    const res = await POST(req({ transactionId: 'tx1', amountMinor: 1.5 }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(mockRefundTenantPayment).not.toHaveBeenCalled();
  });

  it('legacy rows (amount_minor null) keep the PaymentService path', async () => {
    amountMinorOnRow = null;
    mockProcessRefund.mockResolvedValue({ success: true, refundId: 'rf1' });
    const res = await POST(req({ transactionId: 'tx1', amount: 10 }) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(mockProcessRefund).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', transactionId: 'tx1', amount: 10 }));
    expect(mockRefundTenantPayment).not.toHaveBeenCalled();
  });
});
