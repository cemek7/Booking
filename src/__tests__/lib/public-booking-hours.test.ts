import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockResolveCustomer = jest.fn();
const mockCheckBookingConflicts = jest.fn();
const mockAcquireSlotLock = jest.fn();
const mockReleaseSlotLock = jest.fn();
let mockAdmin: ReturnType<typeof createMockAdmin>;

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockAdmin.client,
}));

jest.mock('@/lib/customers/identity', () => ({
  resolveCustomer: (...args: unknown[]) => mockResolveCustomer(...args),
}));

jest.mock('@/lib/doubleBookingPrevention', () => ({
  DoubleBookingPrevention: jest.fn().mockImplementation(() => ({
    acquireSlotLock: mockAcquireSlotLock,
    checkBookingConflicts: mockCheckBookingConflicts,
    releaseSlotLock: mockReleaseSlotLock,
  })),
}));

import { createPublicBooking, getAvailability } from '@/lib/publicBookingService';

const HOURS = {
  mon: { open: '10:00', close: '16:00', closed: false },
  tue: { open: '10:00', close: '16:00', closed: false },
  wed: { open: '10:00', close: '16:00', closed: false },
  thu: { open: '10:00', close: '16:00', closed: false },
  fri: { open: '10:00', close: '16:00', closed: false },
  sat: { open: null, close: null, closed: true },
  sun: { open: null, close: null, closed: true },
};

function createMockAdmin(options: {
  timezone?: string;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  reservations?: Array<{ start_at: string; end_at: string }>;
} = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const tenant = {
    settings: options.settings ?? { business_hours: HOURS },
    metadata: options.metadata ?? {},
    timezone: options.timezone ?? 'Africa/Lagos',
  };

  const from = jest.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const fluent = (op: string) => jest.fn((column?: string, value?: unknown) => {
      if (column) filters.push([op, column, value]);
      return chain;
    });
    chain.select = fluent('select');
    chain.eq = fluent('eq');
    chain.lte = fluent('lte');
    chain.gte = fluent('gte');
    chain.lt = fluent('lt');
    chain.gt = fluent('gt');
    chain.in = jest.fn(async (column: string, value: unknown) => {
      filters.push(['in', column, value]);
      return { data: options.reservations ?? [], error: null };
    });
    chain.maybeSingle = jest.fn(async () => {
      if (table === 'tenants') return { data: tenant, error: null };
      if (table === 'services') return { data: { duration_minutes: 60, price_cents: 10000 }, error: null };
      if (table === 'business_hours') return { data: null, error: null };
      return { data: null, error: null };
    });
    chain.insert = jest.fn((payload: Record<string, unknown>) => {
      inserts.push({ table, payload });
      return chain;
    });
    chain.single = jest.fn(async () => ({ data: { id: 'reservation-1' }, error: null }));
    return chain;
  });

  return { client: { from } as never, filters, inserts };
}

describe('public booking business hours', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdmin = createMockAdmin();
    mockResolveCustomer.mockResolvedValue('customer-1');
    mockAcquireSlotLock.mockResolvedValue({ success: true, lockId: 'lock-1' });
    mockCheckBookingConflicts.mockResolvedValue({ hasConflict: false, conflicts: [] });
    mockReleaseSlotLock.mockResolvedValue({ success: true });
  });

  it('returns no availability on a configured closed day', async () => {
    const slots = await getAvailability('tenant-1', 'service-1', '2026-09-20');
    expect(slots).toEqual([]);
  });

  it('bounds slot labels and reservation queries using tenant-local hours', async () => {
    const slots = await getAvailability('tenant-1', 'service-1', '2026-09-21');

    expect(slots[0]).toEqual({ time: '10:00', available: true });
    expect(slots.at(-1)).toEqual({ time: '15:00', available: true });
    expect(mockAdmin.filters).toContainEqual(['lt', 'start_at', '2026-09-21T23:00:00.000Z']);
    expect(mockAdmin.filters).toContainEqual(['gt', 'end_at', '2026-09-20T23:00:00.000Z']);
  });

  it('converts a public booking from tenant-local time to UTC before insertion', async () => {
    await createPublicBooking('tenant-1', {
      service_id: 'service-1',
      date: '2026-09-21',
      time: '10:00',
      customer_name: 'Ada',
      customer_email: 'ada@example.com',
      customer_phone: '+2348000000000',
    });

    expect(mockAdmin.inserts).toContainEqual({
      table: 'reservations',
      payload: expect.objectContaining({
        start_at: '2026-09-21T09:00:00.000Z',
        end_at: '2026-09-21T10:00:00.000Z',
      }),
    });
  });

  it('uses the configured timezone rather than the application server timezone', async () => {
    mockAdmin = createMockAdmin({ timezone: 'America/New_York' });

    await createPublicBooking('tenant-1', {
      service_id: 'service-1',
      date: '2026-09-21',
      time: '10:00',
      customer_name: 'Ada',
      customer_email: 'ada@example.com',
      customer_phone: '+12025550123',
    });

    expect(mockAdmin.inserts.find((entry) => entry.table === 'reservations')?.payload.start_at)
      .toBe('2026-09-21T14:00:00.000Z');
  });
});
