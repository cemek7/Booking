import { describe, it, expect } from '@jest/globals';
import { estimateSolarSavings } from './estimator';

describe('estimateSolarSavings', () => {
  it('produces deterministic illustrative figures with stated assumptions', () => {
    const r = estimateSolarSavings({ monthlyBillNaira: 100000, propertyType: 'residential' });
    expect(r.systemSizeKw).toBeGreaterThan(0);
    expect(r.estimatedMonthlySavingsNaira).toBeGreaterThan(0);
    expect(r.estimatedMonthlySavingsNaira).toBeLessThanOrEqual(100000);
    expect(r.paybackYears).toBeGreaterThan(0);
    expect(r.assumptions.join(' ')).toMatch(/illustrative/i);
  });
});
