// Explicit constants for the illustrative Haven Realty mortgage estimator.
// This is a demonstrator widget: figures are illustrative, not a financial quote.

const MONTHS_PER_YEAR = 12;

export interface MortgageInput {
  /** Loan principal in Naira. */
  principal: number;
  /** Annual interest rate as a percent, e.g. 24 for 24%. */
  ratePct: number;
  /** Loan term in years. */
  years: number;
}

export interface MortgageEstimate {
  monthlyPaymentNaira: number;
  totalRepaymentNaira: number;
  totalInterestNaira: number;
  assumptions: string[];
}

/**
 * Standard amortising-loan monthly payment:
 *   M = P · r / (1 − (1 + r)^−n)
 * where r is the monthly rate and n the number of monthly payments.
 * A zero rate falls back to straight-line principal / months.
 * Deterministic and pure — no side effects.
 */
export function estimateMonthlyPayment(input: MortgageInput): MortgageEstimate {
  const months = Math.max(1, Math.round(input.years * MONTHS_PER_YEAR));
  const monthlyRate = input.ratePct / 100 / MONTHS_PER_YEAR;

  const monthlyRaw =
    monthlyRate === 0
      ? input.principal / months
      : (input.principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));

  const monthlyPaymentNaira = Math.round(monthlyRaw);
  const totalRepaymentNaira = monthlyPaymentNaira * months;
  const totalInterestNaira = Math.max(0, totalRepaymentNaira - Math.round(input.principal));

  return {
    monthlyPaymentNaira,
    totalRepaymentNaira,
    totalInterestNaira,
    assumptions: [
      'Illustrative estimate — for demonstration only, not a mortgage offer or financial advice.',
      'Assumes a fixed annual rate and equal monthly repayments over the full term.',
      'Excludes fees, insurance, taxes, and rate changes; actual terms depend on the lender.',
    ],
  };
}
