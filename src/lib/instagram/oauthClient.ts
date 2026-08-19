import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

/**
 * Instagram API with Instagram Login — OAuth client.
 *
 * Flow (current Meta docs, Graph API v25.0):
 *   1. Authorize: https://www.instagram.com/oauth/authorize
 *      ?client_id&redirect_uri&response_type=code&scope&state
 *   2. Code → short-lived token (1h):  POST https://api.instagram.com/oauth/access_token
 *   3. Short → long-lived token (60d): GET  https://graph.instagram.com/access_token
 *        ?grant_type=ig_exchange_token
 *
 * Scopes: instagram_business_basic, instagram_business_manage_messages
 */

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const CODE_EXCHANGE_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_LIVED_URL = 'https://graph.instagram.com/access_token';

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
];

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Read the OAuth config from env. Returns null if not configured (so callers can 503 cleanly). */
export function getInstagramOAuthConfig(): InstagramOAuthConfig | null {
  const appId = process.env.INSTAGRAM_APP_ID || '';
  const appSecret = process.env.INSTAGRAM_APP_SECRET || '';
  const redirectUri =
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI ||
    `${(process.env.APP_URL || '').replace(/\/+$/, '')}/api/auth/instagram/callback`;

  if (!appId || !appSecret || !redirectUri.startsWith('http')) return null;
  return { appId, appSecret, redirectUri };
}

/** Build the Instagram authorization URL the user is redirected to. */
export function buildAuthorizeUrl(cfg: InstagramOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface ShortLivedToken {
  accessToken: string;
  /** Instagram-scoped user/business account id. */
  userId: string;
}

/** Step 2: exchange the authorization code for a short-lived token + the IG account id. */
export async function exchangeCodeForToken(
  cfg: InstagramOAuthConfig,
  code: string
): Promise<ShortLivedToken> {
  const body = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
    code,
  });

  const res = await fetchWithTimeout(CODE_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeoutMs: 15_000,
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    user_id?: string | number;
    error_message?: string;
    error_type?: string;
  };

  if (!res.ok || !json.access_token || json.user_id == null) {
    throw new Error(
      `Instagram code exchange failed (${res.status}): ${json.error_message || json.error_type || 'unknown'}`
    );
  }

  return { accessToken: json.access_token, userId: String(json.user_id) };
}

export interface LongLivedToken {
  accessToken: string;
  /** Seconds until expiry (typically ~5184000 = 60 days). */
  expiresIn: number;
}

/** Step 3: exchange the short-lived token for a long-lived (60-day) token. */
export async function exchangeForLongLivedToken(
  cfg: InstagramOAuthConfig,
  shortLivedToken: string
): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: cfg.appSecret,
    access_token: shortLivedToken,
  });

  const res = await fetchWithTimeout(`${LONG_LIVED_URL}?${params.toString()}`, {
    method: 'GET',
    timeoutMs: 15_000,
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Instagram long-lived token exchange failed (${res.status}): ${json.error?.message || 'unknown'}`
    );
  }

  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 60 * 24 * 60 * 60 };
}
