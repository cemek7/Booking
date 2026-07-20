import { describe, expect, it } from '@jest/globals';
import { snapshotReservationTotalCents } from './reservationSnapshot';

function mockAdmin({
  lines,
  prices,
  fallbackServiceId,
}: {
  lines: Array<{ service_id: string; quantity?: number }>;
  prices: Array<{ id: string; price_cents: number }>;
  fallbackServiceId?: string;
}) {
  return {
    from: (table: string) => {
      if (table === 'reservation_services') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: lines, error: null }),
            }),
          }),
        };
      }
      if (table === 'reservations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { service_id: fallbackServiceId ?? null },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: prices, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe('snapshotReservationTotalCents', () => {
  it('sums price_cents × quantity across multiple service lines', async () => {
    const admin = mockAdmin({
      lines: [
        { service_id: 's1', quantity: 2 },
        { service_id: 's2', quantity: 1 },
      ],
      prices: [
        { id: 's1', price_cents: 500_000 },
        { id: 's2', price_cents: 800_000 },
      ],
    });

    expect(await snapshotReservationTotalCents(admin, 't1', 'res1')).toBe(1_800_000);
  });

  it('falls back to the single service_id when no reservation_services rows exist', async () => {
    const admin = mockAdmin({
      lines: [],
      fallbackServiceId: 's9',
      prices: [{ id: 's9', price_cents: 300_000 }],
    });

    expect(await snapshotReservationTotalCents(admin, 't1', 'res1')).toBe(300_000);
  });
});
