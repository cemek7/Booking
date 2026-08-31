import { describe, expect, it, jest } from '@jest/globals';
import { SiasOperationsService } from '@/lib/sias-operations';

function createService() {
  const maybeSingle = jest.fn(async () => ({ data: { id: 'attribution-1' }, error: null }));
  const select = jest.fn(() => ({ maybeSingle }));
  const insert = jest.fn((payload: unknown) => ({ select, payload }));
  const from = jest.fn(() => ({ insert }));
  const service = new SiasOperationsService({ from });

  return { service, from, insert };
}

describe('SiasOperationsService revenue attribution', () => {
  it('inserts explicit verified money fields using database column names', async () => {
    const { service, insert } = createService();

    await service.recordOutcomeAttribution({
      tenantId: 'tenant-1',
      signal: 'revenue_recovery',
      sourceEvent: 'cron.rebooking_nudge',
      attributionType: 'recovered',
      verificationStatus: 'system_verified',
      amountCents: 4_500_000,
      currency: 'NGN',
      evidenceType: 'payment_completed',
      verifiedAt: '2026-08-29T10:00:00.000Z',
      verifiedBy: 'user-1',
      attributionWindowStartedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      attribution_type: 'recovered',
      verification_status: 'system_verified',
      amount_cents: 4_500_000,
      currency: 'NGN',
      evidence_type: 'payment_completed',
      verified_at: '2026-08-29T10:00:00.000Z',
      verified_by: 'user-1',
      attribution_window_started_at: '2026-08-01T00:00:00.000Z',
    }));
  });

  it.each([
    ['negative amount', { attributionType: 'processed', amountCents: -1, currency: 'NGN' }],
    ['fractional minor units', { attributionType: 'processed', amountCents: 10.5, currency: 'NGN' }],
    ['lowercase currency', { attributionType: 'processed', amountCents: 1000, currency: 'ngn' }],
    ['verified status without evidence', { verificationStatus: 'merchant_confirmed' }],
    ['amount without attribution type', { amountCents: 1000, currency: 'NGN' }],
    ['amount without currency', { attributionType: 'processed', amountCents: 1000 }],
  ])('rejects %s before querying the database', async (_label, invalidFields) => {
    const { service, from } = createService();

    await expect(service.recordOutcomeAttribution({
      tenantId: 'tenant-1',
      signal: 'payment_completed',
      sourceEvent: 'payment.webhook',
      ...invalidFields,
    })).rejects.toThrow();

    expect(from).not.toHaveBeenCalled();
  });

  it('keeps non-monetary signals as unverified counts', async () => {
    const { service, insert } = createService();

    await service.recordOutcomeAttribution({
      tenantId: 'tenant-1',
      signal: 'repeat_booking_lift',
      sourceEvent: 'campaign.sent',
      value: 1,
      attributionType: 'influenced',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      value: 1,
      attribution_type: 'influenced',
      verification_status: 'unverified',
      amount_cents: null,
      currency: null,
    }));
  });
});
