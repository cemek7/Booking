export interface CloseInputs {
  completedReservations: Array<{
    id: string;
    priceSnapshotCents: number;
    discountCents: number;
    discountReason: string | null;
    paidCents: number;
  }>;
  fulfilledOrders: Array<{
    id: string;
    totalCents: number;
    deliveryFeeCents: number;
    discountCents: number;
    paidCents: number;
    paymentStatus: string;
  }>;
  refundsCents: number;
  creditsCents: number;
  approvedOutstandingCents: number;
}

export interface CloseItem {
  itemType: 'unpaid_completed_service' | 'delivered_unpaid_order' | 'discount_without_reason';
  severity: 'low' | 'medium' | 'high';
  entityType: string;
  entityId: string;
  expectedCents: number | null;
  actualCents: number | null;
  differenceCents: number | null;
  detail: Record<string, unknown>;
}

export interface CloseResult {
  expectedRevenueCents: number;
  adjustedExpectedCents: number;
  recordedPaymentsCents: number;
  approvedOutstandingCents: number;
  revenueGapCents: number;
  breakdown: Record<string, number>;
  items: CloseItem[];
}

export function computeCloseFromInputs(input: CloseInputs): CloseResult {
  const serviceExpected = input.completedReservations.reduce(
    (sum, reservation) => sum + reservation.priceSnapshotCents,
    0
  );
  const orderExpected = input.fulfilledOrders.reduce(
    (sum, order) => sum + order.totalCents + order.deliveryFeeCents,
    0
  );
  const deliveryTotal = input.fulfilledOrders.reduce(
    (sum, order) => sum + order.deliveryFeeCents,
    0
  );
  const expectedRevenueCents = serviceExpected + orderExpected;

  const reservationDiscounts = input.completedReservations.reduce(
    (sum, reservation) => sum + reservation.discountCents,
    0
  );
  const orderDiscounts = input.fulfilledOrders.reduce(
    (sum, order) => sum + order.discountCents,
    0
  );
  const discountsTotal = reservationDiscounts + orderDiscounts;

  const adjustedExpectedCents =
    expectedRevenueCents - discountsTotal - input.refundsCents - input.creditsCents;

  const recordedPaymentsCents =
    input.completedReservations.reduce((sum, reservation) => sum + reservation.paidCents, 0) +
    input.fulfilledOrders.reduce((sum, order) => sum + order.paidCents, 0);

  const revenueGapCents =
    adjustedExpectedCents - recordedPaymentsCents - input.approvedOutstandingCents;

  const items: CloseItem[] = [];

  for (const reservation of input.completedReservations) {
    if (reservation.paidCents <= 0) {
      items.push({
        itemType: 'unpaid_completed_service',
        severity: 'high',
        entityType: 'reservation',
        entityId: reservation.id,
        expectedCents: reservation.priceSnapshotCents,
        actualCents: reservation.paidCents,
        differenceCents: reservation.priceSnapshotCents - reservation.paidCents,
        detail: {},
      });
    }

    if (reservation.discountCents > 0 && !reservation.discountReason) {
      items.push({
        itemType: 'discount_without_reason',
        severity: 'medium',
        entityType: 'reservation',
        entityId: reservation.id,
        expectedCents: null,
        actualCents: reservation.discountCents,
        differenceCents: null,
        detail: {},
      });
    }
  }

  for (const order of input.fulfilledOrders) {
    if (order.paymentStatus !== 'paid') {
      items.push({
        itemType: 'delivered_unpaid_order',
        severity: 'high',
        entityType: 'retail_order',
        entityId: order.id,
        expectedCents: order.totalCents + order.deliveryFeeCents,
        actualCents: order.paidCents,
        differenceCents: order.totalCents + order.deliveryFeeCents - order.paidCents,
        detail: {},
      });
    }
  }

  return {
    expectedRevenueCents,
    adjustedExpectedCents,
    recordedPaymentsCents,
    approvedOutstandingCents: input.approvedOutstandingCents,
    revenueGapCents,
    breakdown: {
      serviceExpected,
      orderExpected,
      deliveryTotal,
      discountsTotal,
      refunds: input.refundsCents,
      credits: input.creditsCents,
    },
    items,
  };
}
