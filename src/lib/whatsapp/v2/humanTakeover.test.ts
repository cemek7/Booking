import { describe, expect, it } from '@jest/globals';

import {
  isHumanHandling,
} from '@/lib/whatsapp/v2/humanTakeover';

describe('isHumanHandling', () => {
  const now = Date.parse('2026-06-30T12:00:00.000Z');

  it('returns true when human_handling_until is in the future', () => {
    expect(
      isHumanHandling({ human_handling_until: '2026-06-30T12:30:00.000Z' }, now)
    ).toBe(true);
  });

  it('returns false when the flag is expired or missing', () => {
    expect(
      isHumanHandling({ human_handling_until: '2026-06-30T11:30:00.000Z' }, now)
    ).toBe(false);
    expect(isHumanHandling({}, now)).toBe(false);
    expect(isHumanHandling(null, now)).toBe(false);
  });

  it('returns true for an explicit until-released handoff without an expiry', () => {
    expect(isHumanHandling({ human_handling_mode: 'until_released' }, now)).toBe(true);
  });
});
