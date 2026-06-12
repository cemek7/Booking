// src/lib/consent/consentStore.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  getConsent,
  hasDecided,
  hasAnalyticsConsent,
  setConsent,
  onConsentChange,
} from '@/lib/consent/consentStore';

describe('consentStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null and undecided before any choice', () => {
    expect(getConsent()).toBeNull();
    expect(hasDecided()).toBe(false);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('persists an analytics-granted decision', () => {
    const state = setConsent(true);
    expect(state.analytics).toBe(true);
    expect(typeof state.decidedAt).toBe('string');
    expect(hasDecided()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(true);
    expect(getConsent()?.analytics).toBe(true);
  });

  it('persists an analytics-rejected decision', () => {
    setConsent(false);
    expect(hasDecided()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsub = onConsentChange(listener);
    setConsent(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setConsent(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats corrupt storage as undecided', () => {
    window.localStorage.setItem('boka_consent_v1', 'not-json');
    expect(getConsent()).toBeNull();
  });
});
