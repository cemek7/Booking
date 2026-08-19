import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

const mockRecordMovement = jest.fn();
const mockRecordBusinessEvent = jest.fn();
const mockStartCountSession = jest.fn();
const mockGetCountSessionWithItems = jest.fn();
const mockEnterCount = jest.fn();
const mockMarkReservationCompleted = jest.fn();

jest.mock('@/lib/inventory/recordMovement', () => ({
  recordMovement: (...args: unknown[]) => mockRecordMovement(...args),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    EXPENSE_RECORDED: 'expense.recorded',
    PURCHASE_RECORDED: 'purchase.recorded',
    SUPPLIER_PAYMENT_RECORDED: 'supplier_payment.recorded',
    STOCK_RECEIPT_RECORDED: 'stock_receipt.recorded',
    PAYMENT_RECORDED: 'payment.recorded',
    CAPTURE_CONFIRMED: 'capture.confirmed',
    RESERVATION_COMPLETED: 'reservation.completed',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

jest.mock('@/lib/inventory/stockCountService', () => ({
  startCountSession: (...args: unknown[]) => mockStartCountSession(...args),
  getCountSessionWithItems: (...args: unknown[]) => mockGetCountSessionWithItems(...args),
  enterCount: (...args: unknown[]) => mockEnterCount(...args),
}));

jest.mock('@/lib/reconciliation/reservationSnapshot', () => ({
  markReservationCompleted: (...args: unknown[]) => mockMarkReservationCompleted(...args),
}));

import { captureHandlers } from './capture';

function makeAdmin() {
  return {
    from: jest.fn((table: string) => {
      if (table === 'products') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ id: 'product-1', name: 'Relaxer' }],
            error: null,
          }),
        };
      }
      if (table === 'reservations') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: 'res-1', tenant_id: 'tenant-1', status: 'confirmed' },
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
        };
      }
      if (table === 'transactions') {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: 'tx-1', subject_id: 'res-1', status: 'success' },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient;
}

describe('captureHandlers', () => {
  beforeEach(() => {
    mockRecordMovement.mockReset();
    mockRecordBusinessEvent.mockReset();
    mockStartCountSession.mockReset();
    mockGetCountSessionWithItems.mockReset();
    mockEnterCount.mockReset();
    mockMarkReservationCompleted.mockReset();
  });

  it('create_stock_count_session opens a stock-count session and pre-fills matched counts', async () => {
    mockStartCountSession.mockResolvedValue({ id: 'session-1' });
    mockGetCountSessionWithItems.mockResolvedValue({
      session: { id: 'session-1' },
      items: [{ id: 'item-1', product_id: 'product-1', variant_id: null }],
    });
    mockEnterCount.mockResolvedValue({ id: 'item-1', counted_quantity: 5 });

    const admin = makeAdmin();
    const result = await captureHandlers.create_stock_count_session.execute(
      admin,
      'tenant-1',
      {
        items: [{ product_name: 'Relaxer', counted_units: 5 }],
      },
      { actorId: 'user-1' },
    );

    expect(mockStartCountSession).toHaveBeenCalledWith(admin, 'tenant-1', null, 'user-1');
    expect(mockEnterCount).toHaveBeenCalledWith(admin, 'item-1', 5);
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: { stock_count_session: { id: 'session-1' } },
    }));
  });

  it('complete_service_capture completes the reservation and records a manual payment', async () => {
    const admin = makeAdmin();

    const result = await captureHandlers.complete_service_capture.execute(
      admin,
      'tenant-1',
      {
        reservation_id: 'res-1',
        payment_amount_cents: 12000,
        payment_method: 'cash',
        reference: 'walkin-cash',
      },
      { actorId: 'user-1' },
    );

    expect(mockMarkReservationCompleted).toHaveBeenCalledWith(admin, 'tenant-1', 'res-1', 'user-1');
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.PAYMENT_RECORDED,
        entityType: 'transaction',
        metadata: expect.objectContaining({
          reservation_id: 'res-1',
          amount_cents: 12000,
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: { reservation: { id: 'res-1' } },
    }));
  });
});
