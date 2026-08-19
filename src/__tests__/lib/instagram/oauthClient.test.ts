import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import {
  getInstagramOAuthConfig,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  INSTAGRAM_SCOPES,
  type InstagramOAuthConfig,
} from '@/lib/instagram/oauthClient';

const mockFetch = fetchWithTimeout as jest.MockedFunction<typeof fetchWithTimeout>;

function jsonResponse(json: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response;
}

const CFG: InstagramOAuthConfig = {
  appId: 'APP_ID',
  appSecret: 'APP_SECRET',
  redirectUri: 'https://example.com/api/auth/instagram/callback',
};

describe('instagram oauthClient', () => {
  const origEnv = { ...process.env };
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => { process.env = { ...origEnv }; });

  describe('getInstagramOAuthConfig', () => {
    it('returns null when not configured', () => {
      delete process.env.INSTAGRAM_APP_ID;
      delete process.env.INSTAGRAM_APP_SECRET;
      expect(getInstagramOAuthConfig()).toBeNull();
    });

    it('derives redirect_uri from APP_URL when not set explicitly', () => {
      process.env.INSTAGRAM_APP_ID = 'A';
      process.env.INSTAGRAM_APP_SECRET = 'S';
      process.env.APP_URL = 'https://boka.example';
      delete process.env.INSTAGRAM_OAUTH_REDIRECT_URI;
      expect(getInstagramOAuthConfig()?.redirectUri).toBe(
        'https://boka.example/api/auth/instagram/callback'
      );
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('includes client_id, redirect_uri, scopes and state', () => {
      const url = new URL(buildAuthorizeUrl(CFG, 'STATE123'));
      expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('APP_ID');
      expect(url.searchParams.get('redirect_uri')).toBe(CFG.redirectUri);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe(INSTAGRAM_SCOPES.join(','));
      expect(url.searchParams.get('state')).toBe('STATE123');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('returns access token + stringified user id on success', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ access_token: 'short', user_id: 17841400000000000 }));
      const res = await exchangeCodeForToken(CFG, 'CODE');
      expect(res).toEqual({ accessToken: 'short', userId: '17841400000000000' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.instagram.com/oauth/access_token');
      expect((opts as { method?: string }).method).toBe('POST');
    });

    it('throws on a non-ok response', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error_message: 'bad code' }, false, 400));
      await expect(exchangeCodeForToken(CFG, 'CODE')).rejects.toThrow(/code exchange failed/i);
    });
  });

  describe('exchangeForLongLivedToken', () => {
    it('returns long-lived token + expiry', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ access_token: 'long', expires_in: 5184000 }));
      const res = await exchangeForLongLivedToken(CFG, 'short');
      expect(res).toEqual({ accessToken: 'long', expiresIn: 5184000 });
      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).toContain('https://graph.instagram.com/access_token');
      expect(String(url)).toContain('grant_type=ig_exchange_token');
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: { message: 'nope' } }, false, 400));
      await expect(exchangeForLongLivedToken(CFG, 'short')).rejects.toThrow(/long-lived token exchange failed/i);
    });
  });
});
