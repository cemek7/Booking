import { describe, expect, it } from '@jest/globals';
import { hasCapability } from './capabilityMap';

describe('hasCapability', () => {
  it('grants owners full capabilities', () => {
    expect(hasCapability('owner', 'refund')).toBe(true);
    expect(hasCapability('owner', 'manage_staff')).toBe(true);
  });

  it('denies unsafe capabilities to staff but allows stock adjustments', () => {
    expect(hasCapability('staff', 'refund')).toBe(false);
    expect(hasCapability('staff', 'adjust_stock')).toBe(true);
  });
});
