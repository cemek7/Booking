/**
 * Public booking conflict tests.
 * Application pre-checks provide friendly responses; migration 152's exclusion
 * constraint is the final authority for concurrent writes.
 */

const mockResolveCustomer = jest.fn();
const mockAcquireSlotLock = jest.fn();
const mockReleaseSlotLock = jest.fn();
const mockCheckBookingConflicts = jest.fn();
let mockSupabase: ReturnType<typeof createClient>;

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockSupabase,
}));

jest.mock('@/lib/customers/identity', () => ({
  resolveCustomer: (...args: unknown[]) => mockResolveCustomer(...args),
}));

jest.mock('@/lib/doubleBookingPrevention', () => ({
  DoubleBookingPrevention: jest.fn().mockImplementation(() => ({
    acquireSlotLock: mockAcquireSlotLock,
    releaseSlotLock: mockReleaseSlotLock,
    checkBookingConflicts: mockCheckBookingConflicts,
  })),
}));

import { createPublicBooking } from '@/lib/publicBookingService';

const HOURS = {
  mon: { open: '09:00', close: '17:00', closed: false },
  tue: { open: '09:00', close: '17:00', closed: false },
  wed: { open: '09:00', close: '17:00', closed: false },
  thu: { open: '09:00', close: '17:00', closed: false },
  fri: { open: '09:00', close: '17:00', closed: false },
  sat: { open: null, close: null, closed: true },
  sun: { open: null, close: null, closed: true },
};

function createClient(insertError: { code?: string; message: string } | null = null) {
  const from = jest.fn((table: string) => {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.insert = jest.fn(() => chain);
    chain.maybeSingle = jest.fn(async () => {
      if (table === 'services') return { data: { duration_minutes: 60, price_cents: 10000 }, error: null };
      if (table === 'tenants') return {
        data: { settings: { business_hours: HOURS }, metadata: {}, timezone: 'Africa/Lagos' },
        error: null,
      };
      return { data: null, error: null };
    });
    chain.single = jest.fn(async () => insertError
      ? { data: null, error: insertError }
      : { data: { id: 'booking-123' }, error: null });
    return chain;
  });
  return { from };
}

const payload = {
  service_id: 'service-123',
  date: '2026-09-24',
  time: '10:00',
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  customer_phone: '+2348000000000',
};

describe('publicBookingService conflict detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createClient();
    mockResolveCustomer.mockResolvedValue('customer-123');
    mockCheckBookingConflicts.mockResolvedValue({ hasConflict: false, conflicts: [] });
  });

  it('keeps the friendly pre-check without using reservation_locks', async () => {
    await createPublicBooking('tenant-123', payload);

    expect(mockCheckBookingConflicts).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      startAt: '2026-09-24T09:00:00.000Z',
      endAt: '2026-09-24T10:00:00.000Z',
      resourceIds: undefined,
      checkUnassignedOnly: true,
    });
    expect(mockAcquireSlotLock).not.toHaveBeenCalled();
    expect(mockReleaseSlotLock).not.toHaveBeenCalled();
  });

  it('scopes the friendly pre-check to an assigned staff member', async () => {
    await createPublicBooking('tenant-123', { ...payload, staff_id: 'staff-456' });

    expect(mockCheckBookingConflicts).toHaveBeenCalledWith(expect.objectContaining({
      resourceIds: ['staff-456'],
      checkUnassignedOnly: false,
    }));
  });

  it('rejects a conflict found before insertion', async () => {
    mockCheckBookingConflicts.mockResolvedValue({
      hasConflict: true,
      conflicts: [{ reservation_id: 'existing-booking' }],
    });

    await expect(createPublicBooking('tenant-123', payload))
      .rejects.toThrow('Selected time slot is no longer available.');
  });

  it('maps the database race winner to conflict semantics', async () => {
    mockSupabase = createClient({ code: '23P01', message: 'exclusion constraint violation' });

    await expect(createPublicBooking('tenant-123', payload))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
