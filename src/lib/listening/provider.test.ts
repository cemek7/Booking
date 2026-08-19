import { afterEach, describe, expect, it } from '@jest/globals';
import { createListeningProvider, StubProvider } from '@/lib/listening/provider';

const originalProvider = process.env.SOCIAL_LISTENING_PROVIDER;
const originalApiKey = process.env.GOOGLE_PSE_API_KEY;
const originalCx = process.env.GOOGLE_PSE_CX;
const originalLimit = process.env.GOOGLE_PSE_RESULT_LIMIT;

afterEach(() => {
  process.env.SOCIAL_LISTENING_PROVIDER = originalProvider;
  process.env.GOOGLE_PSE_API_KEY = originalApiKey;
  process.env.GOOGLE_PSE_CX = originalCx;
  process.env.GOOGLE_PSE_RESULT_LIMIT = originalLimit;
});

describe('createListeningProvider', () => {
  it('defaults to the stub provider', () => {
    delete process.env.SOCIAL_LISTENING_PROVIDER;
    expect(createListeningProvider()).toBe(StubProvider);
  });

  it('builds the Google provider when configured', () => {
    process.env.SOCIAL_LISTENING_PROVIDER = 'google_pse';
    process.env.GOOGLE_PSE_API_KEY = 'key';
    process.env.GOOGLE_PSE_CX = 'cx';
    process.env.GOOGLE_PSE_RESULT_LIMIT = '7';

    const provider = createListeningProvider();
    expect(provider.name).toBe('google_pse');
  });

  it('throws when required env vars are missing', () => {
    process.env.SOCIAL_LISTENING_PROVIDER = 'google_pse';
    delete process.env.GOOGLE_PSE_API_KEY;
    delete process.env.GOOGLE_PSE_CX;

    expect(() => createListeningProvider()).toThrow('Missing required env var: GOOGLE_PSE_API_KEY');
  });
});
