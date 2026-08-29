import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const runOperatingDeliveryBatch = jest.fn();
const createSupabaseAdminClient = jest.fn(() => ({ id: 'admin' }));

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
jest.mock('@/lib/operating-loop/delivery-worker', () => ({ runOperatingDeliveryBatch }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient }));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({ getConversation: jest.fn() }));
jest.mock('@/lib/whatsapp/v2/deliverability/governedSend', () => ({ sendGovernedInitiated: jest.fn() }));
jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({ brandCustomerText: jest.fn() }));
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({ getTenantWhatsAppProviderClient: jest.fn() }));

import { GET } from '@/app/api/worker/operating-loop/route';

const originalNodeEnv = process.env.NODE_ENV;
const originalCronSecret = process.env.CRON_SECRET;

describe('GET /api/worker/operating-loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.CRON_SECRET = 'worker-secret';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.CRON_SECRET = originalCronSecret;
  });

  it('rejects a production request without the worker bearer secret before claiming deliveries', async () => {
    const response = await GET(new Request('https://booka.test/api/worker/operating-loop'));

    expect(response).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(runOperatingDeliveryBatch).not.toHaveBeenCalled();
  });

  it('fails closed in production when the worker secret is not configured', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(new Request('https://booka.test/api/worker/operating-loop', {
      headers: { authorization: 'Bearer undefined' },
    }));

    expect(response).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(runOperatingDeliveryBatch).not.toHaveBeenCalled();
  });

  it('rejects a wrong production bearer secret before claiming deliveries', async () => {
    const request = new Request('https://booka.test/api/worker/operating-loop');
    request.headers.set('authorization', 'Bearer wrong-secret');

    const response = await GET(request);

    expect(response).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(runOperatingDeliveryBatch).not.toHaveBeenCalled();
  });

  it('runs the governed delivery batch for an authorized production request', async () => {
    runOperatingDeliveryBatch.mockResolvedValue({ claimed: 1, sent: 1, held: 0, failed: 0 });
    const request = new Request('https://booka.test/api/worker/operating-loop');
    request.headers.set('authorization', 'Bearer worker-secret');

    const response = await GET(request);

    expect(response).toEqual({ status: 200, body: { claimed: 1, sent: 1, held: 0, failed: 0 } });
    expect(runOperatingDeliveryBatch).toHaveBeenCalledWith(expect.objectContaining({ admin: { id: 'admin' } }));
  });
});
