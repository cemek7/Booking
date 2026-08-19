import { describe, expect, it } from '@jest/globals';

import { convert } from './uom';

describe('convert', () => {
  it('converts liters to milliliters', () => {
    expect(convert(1, 'l', 'ml')).toBe(1000);
  });

  it('converts packs to pieces using pack size', () => {
    expect(convert(2, 'pack', 'piece', 6)).toBe(12);
  });

  it('throws for non-convertible units', () => {
    expect(() => convert(1, 'ml', 'g')).toThrow('Cannot convert ml to g');
  });
});
