import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCheckBookingConflicts = jest.fn();

jest.mock('@/lib/doubleBookingPrevention', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    checkBookingConflicts: mockCheckBookingConflicts,
  })),
}));

import { createReservation } from '@/lib/reservationService';

function clientRejectingInsert(code: string) {
  const chain: Record<string, jest.Mock> = {};
  chain.insert = jest.fn(() => chain);
  chain.select = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({
    data: null,
    error: { code, message: 'conflicting key value violates exclusion constraint' },
  }));
  return { from: jest.fn(() => chain) };
}

describe('reservation database conflict normalization', () => {
  beforeEach(() => {
    mockCheckBookingConflicts.mockResolvedValue({ hasConflict: false, conflicts: [] });
  });

  it('maps PostgreSQL exclusion violations to the application conflict contract', async () => {
    const client = clientRejectingInsert('23P01');

    await expect(createReservation(client as never, {
      tenant_id: 'tenant-1',
      customer_id: 'customer-1',
      start_at: '2026-09-24T09:00:00.000Z',
      end_at: '2026-09-24T10:00:00.000Z',
      staff_id: '00000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringMatching(/unavailable/i),
    });
  });
});
