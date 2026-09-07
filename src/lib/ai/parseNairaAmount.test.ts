import { describe, expect, it } from '@jest/globals';
import { parseNairaAmount } from './parseNairaAmount';

describe('parseNairaAmount', () => {
  it('parses comma-separated naira amounts', () => {
    expect(parseNairaAmount('₦18,000')).toBe(1_800_000);
  });

  it('parses word amounts', () => {
    expect(parseNairaAmount('thirty thousand')).toBe(3_000_000);
  });

  it('parses compact k-form amounts', () => {
    expect(parseNairaAmount('25k')).toBe(2_500_000);
  });
});
