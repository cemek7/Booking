import { describe, it, expect } from '@jest/globals';
import { calculateSettlement, isValidAmountMinor, MAX_AMOUNT_MINOR, type FeePolicy } from '@/lib/payments/settlementPolicy';

const pilot: FeePolicy = { code: 'pilot_ngn_v1', version: 1, basisPoints: 100, capMinor: 200000, feeBearer: 'subaccount' };

describe('isValidAmountMinor', () => {
  it.each([1, 500000, MAX_AMOUNT_MINOR])('accepts %p', (v) => expect(isValidAmountMinor(v)).toBe(true));
  it.each([0, -1, 1.5, NaN, Infinity, '500000', null, undefined, MAX_AMOUNT_MINOR + 1])('rejects %p', (v) =>
    expect(isValidAmountMinor(v)).toBe(false));
});

describe('calculateSettlement', () => {
  it('charges 1% of a NGN 5,000 deposit', () => {
    expect(calculateSettlement(500000, pilot)).toEqual({ amountMinor: 500000, platformFeeMinor: 5000, tenantGrossMinor: 495000 });
  });
  it('floors fractional fees (99 kobo -> 0 fee)', () => {
    expect(calculateSettlement(99, pilot)).toEqual({ amountMinor: 99, platformFeeMinor: 0, tenantGrossMinor: 99 });
  });
  it('floors 150 kobo to 1 kobo fee', () => {
    expect(calculateSettlement(150, pilot).platformFeeMinor).toBe(1);
  });
  it('hits the cap exactly at NGN 200,000', () => {
    expect(calculateSettlement(20_000_000, pilot).platformFeeMinor).toBe(200000);
  });
  it('caps above NGN 200,000', () => {
    expect(calculateSettlement(200_000_000, pilot)).toEqual({ amountMinor: 200_000_000, platformFeeMinor: 200000, tenantGrossMinor: 199_800_000 });
  });
  it('applies no cap when capMinor is null', () => {
    expect(calculateSettlement(200_000_000, { ...pilot, capMinor: null }).platformFeeMinor).toBe(2_000_000);
  });
  it('is exact at the maximum amount', () => {
    const r = calculateSettlement(MAX_AMOUNT_MINOR, { ...pilot, capMinor: null });
    expect(r.platformFeeMinor + r.tenantGrossMinor).toBe(MAX_AMOUNT_MINOR);
  });
  it('rejects invalid amounts', () => {
    expect(() => calculateSettlement(1.5, pilot)).toThrow(RangeError);
  });
  it('rejects invalid basis points', () => {
    expect(() => calculateSettlement(100, { ...pilot, basisPoints: 10001 })).toThrow(RangeError);
  });
});
