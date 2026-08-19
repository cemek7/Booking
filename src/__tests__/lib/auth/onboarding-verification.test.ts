import { describe, it, expect } from '@jest/globals';
import { sessionVerifiesEmail } from '@/lib/auth/onboarding-verification';

describe('sessionVerifiesEmail', () => {
  it('is true when the session email matches the entered email', () => {
    expect(sessionVerifiesEmail('ada@example.com', 'ada@example.com')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(sessionVerifiesEmail('  Ada@Example.com ', 'ada@example.com')).toBe(true);
  });

  it('is false when a leftover session belongs to a DIFFERENT email', () => {
    // The core bug: a stale session for someone else must not bypass verification.
    expect(sessionVerifiesEmail('old-tester@example.com', 'ada@example.com')).toBe(false);
  });

  it('is false when there is no session email', () => {
    expect(sessionVerifiesEmail(null, 'ada@example.com')).toBe(false);
    expect(sessionVerifiesEmail(undefined, 'ada@example.com')).toBe(false);
    expect(sessionVerifiesEmail('', 'ada@example.com')).toBe(false);
  });

  it('is false when no email was entered', () => {
    expect(sessionVerifiesEmail('ada@example.com', '')).toBe(false);
    expect(sessionVerifiesEmail('ada@example.com', null)).toBe(false);
  });
});
