/**
 * Booka platform-fee arithmetic for tenant customer payments.
 * Integer minor units only; BigInt avoids overflow in amount * basisPoints.
 * Rounding is floor, so rounding always favors the tenant.
 */
export const MAX_AMOUNT_MINOR = 100_000_000_000; // NGN 1bn

export type FeePolicy = {
  code: string;
  version: number;
  basisPoints: number;
  capMinor: number | null;
  feeBearer: 'subaccount';
};

export type SettlementAmounts = {
  amountMinor: number;
  platformFeeMinor: number;
  tenantGrossMinor: number;
};

export function isValidAmountMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_MINOR;
}

export function calculateSettlement(amountMinor: number, policy: FeePolicy): SettlementAmounts {
  if (!isValidAmountMinor(amountMinor)) throw new RangeError('amountMinor must be a positive safe integer');
  if (!Number.isInteger(policy.basisPoints) || policy.basisPoints < 0 || policy.basisPoints > 10_000) {
    throw new RangeError('basisPoints must be an integer between 0 and 10000');
  }
  if (policy.capMinor !== null && (!Number.isSafeInteger(policy.capMinor) || policy.capMinor < 0)) {
    throw new RangeError('capMinor must be a non-negative safe integer or null');
  }
  const uncapped = Number((BigInt(amountMinor) * BigInt(policy.basisPoints)) / BigInt(10_000));
  const platformFeeMinor = policy.capMinor === null ? uncapped : Math.min(uncapped, policy.capMinor);
  return { amountMinor, platformFeeMinor, tenantGrossMinor: amountMinor - platformFeeMinor };
}
