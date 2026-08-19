// Explicit constants for illustrative solar savings estimation
// All values are conservative, documented assumptions suitable for Nigeria market

/**
 * Offset ratio: percentage of monthly consumption a solar system can realistically offset
 * Residential: 0.7 (70%) — accounts for daytime usage patterns and night-time grid dependency
 * Commercial: 0.6 (60%) — typically higher peak loads, more conservative offset
 */
const RESIDENTIAL_OFFSET_RATIO = 0.7;
const COMMERCIAL_OFFSET_RATIO = 0.6;

/**
 * Installation cost per kilowatt (Naira)
 * ₦500,000/kW reflects 2026 Nigeria market (panel + inverter + installation + contingency)
 */
const INSTALL_COST_NAIRA_PER_KW = 500_000;

/**
 * Solar generation: kWh produced per kW of installed capacity per day
 * 4.5 kWh/kW/day is conservative for Nigeria (latitude ~4-14°N, average 4.5-5.5 kWh/kW/day)
 */
const KWH_PER_KW_PER_DAY = 4.5;

/**
 * Average tariff: Naira per kWh
 * ₦40/kWh reflects 2026 Nigeria blended commercial + residential tariffs
 * (actual: NERC rates vary ₦35-50 depending on DISCO and band)
 */
const TARIFF_NAIRA_PER_KWH = 40;

/**
 * Days per month (for standardization)
 */
const DAYS_PER_MONTH = 30;

/**
 * Months per year (for payback calculation)
 */
const MONTHS_PER_YEAR = 12;

export interface SolarEstimateInput {
  monthlyBillNaira: number;
  propertyType: 'residential' | 'commercial';
}

export interface SolarEstimate {
  systemSizeKw: number;
  estimatedMonthlySavingsNaira: number;
  paybackYears: number;
  assumptions: string[];
}

export function estimateSolarSavings(input: SolarEstimateInput): SolarEstimate {
  const { monthlyBillNaira, propertyType } = input;

  // Determine offset ratio based on property type
  const offsetRatio =
    propertyType === 'residential'
      ? RESIDENTIAL_OFFSET_RATIO
      : COMMERCIAL_OFFSET_RATIO;

  // Calculate monthly consumption in kWh from the bill
  const monthlyConsumptionKwh = monthlyBillNaira / TARIFF_NAIRA_PER_KWH;

  // Calculate daily consumption in kWh
  const dailyConsumptionKwh = monthlyConsumptionKwh / DAYS_PER_MONTH;

  // Calculate system size needed to offset the target percentage
  const systemSizeKw =
    (dailyConsumptionKwh * offsetRatio) / KWH_PER_KW_PER_DAY;

  // Calculate monthly generation from the system
  const monthlyGenerationKwh = systemSizeKw * KWH_PER_KW_PER_DAY * DAYS_PER_MONTH;

  // Calculate monetary value of monthly generation (savings)
  const potentialMonthlySavingsNaira = monthlyGenerationKwh * TARIFF_NAIRA_PER_KWH;

  // Cap savings at the input bill (cannot save more than you spend)
  const estimatedMonthlySavingsNaira = Math.min(
    potentialMonthlySavingsNaira,
    monthlyBillNaira
  );

  // Calculate annual savings
  const annualSavingsNaira = estimatedMonthlySavingsNaira * MONTHS_PER_YEAR;

  // Calculate system installation cost
  const installationCostNaira = systemSizeKw * INSTALL_COST_NAIRA_PER_KW;

  // Calculate payback period in years
  const paybackYears =
    annualSavingsNaira > 0
      ? installationCostNaira / annualSavingsNaira
      : Number.POSITIVE_INFINITY;

  // Build assumptions array
  // Must start with "Illustrative" as per requirement
  const assumptions: string[] = [
    `Illustrative estimate — not a binding quote or performance guarantee. Based on ${propertyType} property type with ${(offsetRatio * 100).toFixed(0)}% consumption offset assumption.`,
    `Solar system installation cost assumed at ₦${INSTALL_COST_NAIRA_PER_KW.toLocaleString()}/kW (includes panels, inverter, installation, contingency).`,
    `Generation estimate: ${KWH_PER_KW_PER_DAY} kWh/kW/day (conservative for Nigeria ~4°-14°N; actual varies by location, season, and panel efficiency).`,
    `Tariff used for estimate: ₦${TARIFF_NAIRA_PER_KWH}/kWh (blended 2026 Nigerian rates; actual varies by DISCO and consumption band).`,
    `Payback assumes no tariff escalation, consistent generation, and no major maintenance/replacement costs during payback period.`,
    `Actual savings depend on roof orientation, shading, system degradation (~0.5%/year), inverter efficiency, and grid connection stability.`,
  ];

  return {
    systemSizeKw: Math.round(systemSizeKw * 100) / 100,
    estimatedMonthlySavingsNaira: Math.round(estimatedMonthlySavingsNaira),
    paybackYears: Math.round(paybackYears * 10) / 10,
    assumptions,
  };
}
