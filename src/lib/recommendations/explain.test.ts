import { describe, expect, it } from '@jest/globals';

import { explainRecommendation } from './explain';

function numericTokens(value: string) {
  const normalized = value.replace(/,/g, '');
  return Array.from(normalized.matchAll(/\d+(?:\.\d+)?/g)).map((match) => match[0].replace(/^0+(\d)/, '$1'));
}

describe('explainRecommendation', () => {
  it('keeps stockout prose grounded in the provided basis only', () => {
    const explanation = explainRecommendation('likely_stockout', {
      product_name: 'Relaxer',
      current_stock: 10,
      avg_daily_usage: 3,
      days_left: 3.3,
    });

    const combined = `${explanation.title} ${explanation.reason} ${explanation.recommendedAction}`;
    const tokens = numericTokens(combined);

    expect(combined).toContain('Relaxer');
    expect(tokens).toEqual(expect.arrayContaining(['10', '3', '3.3']));
    expect(tokens.every((token) => ['10', '3', '3.3'].includes(token))).toBe(true);
  });

  it('formats poor-margin prose from basis figures without inventing impact', () => {
    const explanation = explainRecommendation('poor_margin_service', {
      service_name: 'Signature Braids',
      avg_revenue_per_booking: 4200,
      avg_material_cost: 1200,
      margin_percent: 28.6,
    });

    const combined = `${explanation.title} ${explanation.reason} ${explanation.recommendedAction}`;
    const tokens = numericTokens(combined);

    expect(combined).toContain('Signature Braids');
    expect(combined).toContain('₦4,200');
    expect(combined).toContain('₦1,200');
    expect(tokens).toEqual(expect.arrayContaining(['4200', '1200', '28.6']));
    expect(tokens.every((token) => ['4200', '1200', '28.6'].includes(token))).toBe(true);
  });
});
