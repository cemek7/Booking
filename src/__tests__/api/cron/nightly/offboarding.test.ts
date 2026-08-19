jest.mock('@/lib/offboarding/purgeWorker', () => ({
  runDueTeardownTasks: jest.fn().mockResolvedValue(2),
  runOperationalPurge: jest.fn().mockResolvedValue(1),
  runFinancialPurge: jest.fn().mockResolvedValue(0),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ from: jest.fn() })) }));
// Route also imports these; stub them so the module loads cleanly.
jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo: jest.fn().mockResolvedValue(undefined),
  sendTelegramAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClient: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: { recordCampaignRun: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/lib/siasCampaignRunner', () => ({
  runDueSiasCampaigns: jest.fn().mockResolvedValue({ processed: 0, delivered: 0, failed: 0 }),
}));
jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({
  brandCustomerText: jest.fn(async (_tenantId: string, _phone: string, reply: string) => reply),
}));
jest.mock('next/server', () => ({
  NextResponse: { json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body: data }) },
}));

import { runOffboardingSweep } from '@/app/api/cron/nightly/route';

describe('runOffboardingSweep', () => {
  it('runs teardown then operational then financial purge and returns the counts', async () => {
    const res = await runOffboardingSweep();
    expect(res).toEqual({ teardown: 2, operational: 1, financial: 0 });
  });
});
