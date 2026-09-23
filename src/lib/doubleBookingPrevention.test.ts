import { describe, expect, it, jest } from '@jest/globals';

jest.mock('./eventBus', () => ({
  publishEvent: jest.fn(async () => undefined),
}));

import { DoubleBookingPrevention } from './doubleBookingPrevention';

describe('DoubleBookingPrevention overlap semantics', () => {
  it('uses half-open comparisons so adjacent bookings do not conflict', async () => {
    const chain = {} as Record<string, jest.Mock> & {
      then: (resolve: (value: unknown) => unknown) => unknown;
    };
    chain.select = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.neq = jest.fn(() => chain);
    chain.lt = jest.fn(() => chain);
    chain.gt = jest.fn(() => chain);
    chain.then = (resolve) => resolve({ data: [], error: null });
    const client = { from: jest.fn(() => chain) };

    await new DoubleBookingPrevention(client as never).checkBookingConflicts({
      tenantId: '00000000-0000-4000-8000-000000000001',
      startAt: '2026-09-24T10:00:00.000Z',
      endAt: '2026-09-24T11:00:00.000Z',
    });

    expect(chain.lt).toHaveBeenCalledWith('start_at', '2026-09-24T11:00:00.000Z');
    expect(chain.gt).toHaveBeenCalledWith('end_at', '2026-09-24T10:00:00.000Z');
  });
});
