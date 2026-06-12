// src/lib/analytics/track.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const captureMock = jest.fn();
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { capture: captureMock },
}));

import { capture } from '@/lib/analytics/track';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { setConsent } from '@/lib/consent/consentStore';

describe('capture', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captureMock.mockClear();
  });

  it('does NOT capture when analytics consent is absent', () => {
    capture(ANALYTICS_EVENTS.BOOKING_CREATED, { id: '1' });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('does NOT capture when analytics consent is rejected', () => {
    setConsent(false);
    capture(ANALYTICS_EVENTS.BOOKING_CREATED);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('captures when analytics consent is granted', () => {
    setConsent(true);
    capture(ANALYTICS_EVENTS.PAYMENT_SUCCEEDED, { amount: 100 });
    expect(captureMock).toHaveBeenCalledWith('payment_succeeded', { amount: 100 });
  });
});
