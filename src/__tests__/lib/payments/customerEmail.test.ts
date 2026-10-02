import { describe, expect, it } from '@jest/globals';
import { getCustomerEmail } from '@/lib/payments/customerEmail';

describe('getCustomerEmail', () => {
  it('uses the real email when present', () => {
    expect(getCustomerEmail(' a@b.com ', '+234 800')).toBe('a@b.com');
  });
  it('derives a per-customer address from phone digits', () => {
    expect(getCustomerEmail(null, '+234 800 000')).toBe('noemail+234800000@example.com');
  });
  it('returns empty (never a shared placeholder) with no email and no digits', () => {
    expect(getCustomerEmail(null, '')).toBe('');
    expect(getCustomerEmail('  ', 'abc')).toBe('');
  });
});
