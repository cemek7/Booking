import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('@/lib/paystack', () => ({ createSubaccount: (...a: unknown[]) => mockCreate(...a) }));
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({ sendErrorAlert: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({ logRequest: jest.fn(), logError: jest.fn(), warn: jest.fn() })),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { POST } from '@/app/api/tenants/[tenantId]/payments/setup/route';

function adminMock() {
  const chain = (final: unknown): Record<string, unknown> => ({
    select: () => chain(final), eq: () => chain(final), neq: () => chain(final),
    maybeSingle: async () => final, single: async () => final,
  });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'usr_1', email: 'o@test.com' } }, error: null }) },
    from: jest.fn((t: string) =>
      t === 'tenant_users' ? chain({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null }) : chain({ data: null, error: null })),
  };
}

describe('deprecated payments setup route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockImplementation(() => adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue({ from: jest.fn() });
  });

  it('returns 410 ENDPOINT_DEPRECATED and never calls Paystack', async () => {
    const req = new NextRequest('http://localhost:3000/api/tenants/ten_1/payments/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', 'x-tenant-id': 'ten_1' },
      body: JSON.stringify({ settlementBank: '058', accountNumber: '0123456789' }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ tenantId: 'ten_1' }) } as never);
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ code: 'ENDPOINT_DEPRECATED', use: '/api/payments/subaccounts' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
