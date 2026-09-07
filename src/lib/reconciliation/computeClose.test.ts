import { describe, expect, it } from '@jest/globals';
import { computeCloseFromInputs } from './computeClose';

describe('computeCloseFromInputs', () => {
  it('computes expected, adjusted, recorded, gap and flags review items', () => {
    const result = computeCloseFromInputs({
      completedReservations: [
        {
          id: 'a',
          priceSnapshotCents: 1_800_000,
          discountCents: 0,
          discountReason: null,
          paidCents: 1_800_000,
        },
        {
          id: 'b',
          priceSnapshotCents: 800_000,
          discountCents: 100_000,
          discountReason: null,
          paidCents: 0,
        },
      ],
      fulfilledOrders: [
        {
          id: 'o1',
          totalCents: 3_000_000,
          deliveryFeeCents: 250_000,
          discountCents: 0,
          paidCents: 3_250_000,
          paymentStatus: 'paid',
        },
        {
          id: 'o2',
          totalCents: 500_000,
          deliveryFeeCents: 0,
          discountCents: 0,
          paidCents: 0,
          paymentStatus: 'unpaid',
        },
      ],
      refundsCents: 0,
      creditsCents: 0,
      approvedOutstandingCents: 0,
    });

    expect(result.expectedRevenueCents).toBe(6_350_000);
    expect(result.adjustedExpectedCents).toBe(6_250_000);
    expect(result.recordedPaymentsCents).toBe(5_050_000);
    expect(result.revenueGapCents).toBe(1_200_000);

    const itemTypes = result.items.map((item) => item.itemType).sort();
    expect(itemTypes).toEqual([
      'delivered_unpaid_order',
      'discount_without_reason',
      'unpaid_completed_service',
    ]);
  });

  it('does not flag a discount that has a reason', () => {
    const result = computeCloseFromInputs({
      completedReservations: [
        {
          id: 'a',
          priceSnapshotCents: 500_000,
          discountCents: 50_000,
          discountReason: 'loyal customer',
          paidCents: 450_000,
        },
      ],
      fulfilledOrders: [],
      refundsCents: 0,
      creditsCents: 0,
      approvedOutstandingCents: 0,
    });

    expect(result.items.find((item) => item.itemType === 'discount_without_reason')).toBeUndefined();
  });
});
