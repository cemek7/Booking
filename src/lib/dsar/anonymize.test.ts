import { describe, it, expect } from '@jest/globals';
import { buildAnonymizedPatch } from '@/lib/dsar/anonymize';

describe('buildAnonymizedPatch', () => {
  it('redacts each PII column to a stable token', () => {
    const patch = buildAnonymizedPatch(['customer_name', 'customer_phone']);
    expect(patch).toEqual({ customer_name: '[erased]', customer_phone: '[erased]' });
  });

  it('returns an empty object when there are no PII columns', () => {
    expect(buildAnonymizedPatch([])).toEqual({});
  });
});
