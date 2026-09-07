import { estimateMonthlyPayment } from './haven-mortgage';

describe('estimateMonthlyPayment', () => {
  it('computes an amortising monthly payment with interest above principal/term', () => {
    const r = estimateMonthlyPayment({ principal: 50_000_000, ratePct: 24, years: 20 });
    // straight-line (no interest) would be 50m / 240 ≈ 208,333; with 24% it must be higher
    expect(r.monthlyPaymentNaira).toBeGreaterThan(208_333);
    expect(r.totalInterestNaira).toBeGreaterThan(0);
    expect(r.totalRepaymentNaira).toBe(r.monthlyPaymentNaira * 240);
  });

  it('falls back to straight-line principal/term at a zero rate', () => {
    const r = estimateMonthlyPayment({ principal: 12_000_000, ratePct: 0, years: 10 });
    expect(r.monthlyPaymentNaira).toBe(100_000); // 12m / 120 months
    expect(r.totalInterestNaira).toBe(0);
  });

  it('labels the output illustrative and not a financial offer', () => {
    const r = estimateMonthlyPayment({ principal: 30_000_000, ratePct: 20, years: 15 });
    expect(r.assumptions[0].toLowerCase()).toContain('illustrative');
  });
});
