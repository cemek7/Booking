/**
 * Canonical business-event action vocabulary (consolidation item C).
 *
 * This is a **dependency-free leaf module**: it imports nothing so it can be
 * referenced from anywhere — including the anomaly rules — without creating an
 * import cycle through `businessEvents.ts` (which pulls in the anomaly/customer
 * subscribers, which pull in the rules). `businessEvents.ts` re-exports this so
 * existing `from '@/lib/audit/businessEvents'` imports keep working.
 */
export const BUSINESS_EVENT_ACTIONS = {
  RESERVATION_COMPLETED: 'reservation.completed',
  PAYMENT_RECORDED: 'payment.recorded',
  RECONCILIATION_COMPUTED: 'reconciliation.computed',
  RECONCILIATION_DELIVERED: 'reconciliation.delivered',
  RETAIL_ORDER_DELIVERED: 'retail_order.delivered',
  DISCOUNT_APPLIED: 'discount.applied',
  PRODUCT_STOCK_ADJUSTED: 'product.stock_adjusted',
  PRODUCT_PRICE_CHANGED: 'product.price_changed',
  PRODUCT_ADDED: 'product.added',
  PRODUCT_AVAILABILITY_CHANGED: 'product.availability_changed',
  STOCK_DAMAGED: 'stock.damaged',
  STOCK_RESTOCKED: 'stock.restocked',
  STOCK_TRANSFERRED: 'stock.transferred',
  STOCK_COUNT_RECORDED: 'stock.count_recorded',
  STOCK_COUNT_APPROVED: 'stock_count.approved',
  RETAIL_SALE_RECORDED: 'retail_sale.recorded',
  EXPENSE_RECORDED: 'expense.recorded',
  PURCHASE_RECORDED: 'purchase.recorded',
  SUPPLIER_PAYMENT_RECORDED: 'supplier_payment.recorded',
  STOCK_RECEIPT_RECORDED: 'stock_receipt.recorded',
  ORDER_REFUNDED: 'order.refunded',
  OUTSTANDING_BALANCE_RECORDED: 'outstanding_balance.recorded',
  RETAIL_ORDER_CREATED: 'retail_order.created',
  ORDER_CANCELLED: 'order.cancelled',
  CUSTOMER_NOTE_ADDED: 'customer.note_added',
  CUSTOMER_TAGGED: 'customer.tagged',
  CUSTOMER_MERGED: 'customer.merged',
  STAFF_PERMISSION_CHANGED: 'staff.permission_changed',
  COMMAND_DENIED: 'command.denied',
  ACCESS_DENIED: 'access.denied',
  ANOMALY_DETECTED: 'anomaly.detected',
  ANOMALY_RESOLVED: 'anomaly.resolved',
  ANOMALY_REVIEWED: 'anomaly.reviewed',
  ANOMALY_ALERTED: 'anomaly.alerted',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  APPROVAL_ALERTED: 'approval.alerted',
  SERVICE_CONSUMPTION_RECORDED: 'service.consumption_recorded',
  CAPTURE_CONFIRMED: 'capture.confirmed',
  RECOMMENDATION_ACCEPTED: 'recommendation.accepted',
  RECOMMENDATION_DISMISSED: 'recommendation.dismissed',
  RECOMMENDATION_SNOOZED: 'recommendation.snoozed',
  RECOMMENDATION_ALERTED: 'recommendation.alerted',
  RECOMMENDATION_OUTCOME_RECORDED: 'recommendation.outcome_recorded',
} as const;

export type BusinessEventAction =
  (typeof BUSINESS_EVENT_ACTIONS)[keyof typeof BUSINESS_EVENT_ACTIONS];
