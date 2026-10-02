import { describe, it, expect, jest } from '@jest/globals';
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));
import { isPaymentHandoffOpen, openReservationPaymentHandoff, type PaymentHandoffStore } from '@/lib/payments/paymentHandoff';

describe('isPaymentHandoffOpen', () => {
  it('is true only for an open handoff object', () => {
    expect(isPaymentHandoffOpen({ payment_handoff: { status: 'open' } })).toBe(true);
    expect(isPaymentHandoffOpen({ payment_handoff: { status: 'resolved' } })).toBe(false);
    expect(isPaymentHandoffOpen(null)).toBe(false);
    expect(isPaymentHandoffOpen({ payment_handoff: 'open' })).toBe(false);
  });
});

describe('openReservationPaymentHandoff', () => {
  const makeStore = () => ({
    loadMetadata: jest.fn(async () => ({ customer_name: 'Ada' })),
    saveMetadata: jest.fn(async () => undefined),
    insertEscalation: jest.fn(async () => undefined),
  }) satisfies PaymentHandoffStore;

  it('marks the reservation open (keeping existing metadata) and escalates once', async () => {
    const store = makeStore();
    await openReservationPaymentHandoff({ tenantId: 't1', reservationId: 'r1', reason: 'SETTLEMENT_NOT_CONFIGURED', customerPhone: '+234', threadId: 'th1' }, store);
    const saved = (store.saveMetadata.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(saved.customer_name).toBe('Ada');
    expect(saved.payment_handoff).toMatchObject({ status: 'open', reason: 'SETTLEMENT_NOT_CONFIGURED' });
    expect(store.insertEscalation).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 't1', session_id: 'reservation:r1', reason_code: 'payment_settlement', status: 'pending',
      customer_phone: '+234', conversation_thread_id: 'th1',
    }));
  });

  it('treats a duplicate escalation as success (idempotent)', async () => {
    const store = makeStore();
    store.insertEscalation.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(openReservationPaymentHandoff({ tenantId: 't1', reservationId: 'r1', reason: 'SETTLEMENT_DISABLED', customerPhone: null }, store)).resolves.toBeUndefined();
  });
});
