import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateServerSupabaseClient = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockCreateServerSupabaseClient(),
  createSupabaseAdminClient: jest.fn(),
}));

import { DialogBookingBridge, type BookingDialogState } from '@/lib/dialogBookingBridge';

const OPEN_HOURS = {
  mon: { open: '10:00', close: '16:00', closed: false },
  tue: { open: '10:00', close: '16:00', closed: false },
  wed: { open: '10:00', close: '16:00', closed: false },
  thu: { open: '10:00', close: '16:00', closed: false },
  fri: { open: '10:00', close: '16:00', closed: false },
  sat: { open: null, close: null, closed: true },
  sun: { open: null, close: null, closed: true },
};

function tenantClient(tenant: Record<string, unknown>) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: tenant, error: null }));
  return { from: jest.fn(() => chain) };
}

async function checkOutsideBusinessHours(
  bridge: DialogBookingBridge,
  state: BookingDialogState = { step: 'intent' },
) {
  const privateBridge = bridge as unknown as {
    checkOutsideBusinessHours: (
      tenantId: string,
      dialogState: BookingDialogState,
    ) => Promise<{ response: string; completed: boolean } | null>;
  };
  return privateBridge.checkOutsideBusinessHours('tenant-1', state);
}

describe('dialog business-hours resolution', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-21T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses canonical settings ahead of legacy metadata', async () => {
    mockCreateServerSupabaseClient.mockReturnValue(tenantClient({
      timezone: 'Africa/Lagos',
      settings: {
        business_hours: {
          ...OPEN_HOURS,
          mon: { open: null, close: null, closed: true },
        },
      },
      metadata: { business_hours: OPEN_HOURS },
    }));

    const result = await checkOutsideBusinessHours(new DialogBookingBridge());

    expect(result?.response).toContain("we're not available right now");
    expect(result?.response).toContain('Tuesday at 10:00');
  });

  it('falls back to metadata while older tenants are migrated', async () => {
    mockCreateServerSupabaseClient.mockReturnValue(tenantClient({
      timezone: 'Africa/Lagos',
      settings: {},
      metadata: { business_hours: OPEN_HOURS },
    }));

    await expect(checkOutsideBusinessHours(new DialogBookingBridge())).resolves.toBeNull();
  });
});
