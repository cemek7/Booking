import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: jest.fn() }));
jest.mock('@/lib/paymentService', () => jest.fn());
jest.mock('@/lib/payments/tenantSettlement', () => ({ initializeTenantPayment: jest.fn() }));

import { computeDepositMinor } from '@/lib/publicBookingService';

describe('computeDepositMinor', () => {
  it('returns 0 when the tenant does not require a deposit', () => {
    expect(computeDepositMinor({ tenantSettings: {}, tenantMetadata: {}, servicePriceCents: 1000000 })).toBe(0);
    expect(computeDepositMinor({ tenantSettings: { depositPercent: 20 }, tenantMetadata: {}, servicePriceCents: 1000000 })).toBe(0);
  });

  it('computes the percentage of the service price', () => {
    expect(computeDepositMinor({
      tenantSettings: { requireDeposit: true, depositPercent: 20 }, tenantMetadata: {}, servicePriceCents: 1000000,
    })).toBe(200000);
  });

  it('honors metadata.ui_settings', () => {
    expect(computeDepositMinor({
      tenantSettings: {}, tenantMetadata: { ui_settings: { requireDeposit: true, depositPercent: 10 } }, servicePriceCents: 1000000,
    })).toBe(100000);
  });

  it('returns 0 for a zero percent', () => {
    expect(computeDepositMinor({
      tenantSettings: { requireDeposit: true, depositPercent: 0 }, tenantMetadata: {}, servicePriceCents: 1000000,
    })).toBe(0);
  });
});
