// src/lib/consent/consentStore.ts
export interface ConsentState {
  analytics: boolean;
  decidedAt: string; // ISO 8601
}

const STORAGE_KEY = 'boka_consent_v1';
type Listener = (state: ConsentState | null) => void;
const listeners = new Set<Listener>();

export function getConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof parsed?.analytics !== 'boolean') return null;
    return { analytics: parsed.analytics, decidedAt: parsed.decidedAt ?? '' };
  } catch {
    return null;
  }
}

export function hasDecided(): boolean {
  return getConsent() !== null;
}

export function hasAnalyticsConsent(): boolean {
  return getConsent()?.analytics === true;
}

export function setConsent(analytics: boolean): ConsentState {
  const state: ConsentState = { analytics, decidedAt: new Date().toISOString() };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  listeners.forEach((l) => l(state));
  return state;
}

export function onConsentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
