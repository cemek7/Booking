export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import {
  getInstagramOAuthConfig,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
} from '@/lib/instagram/oauthClient';
import { verifyState } from '@/lib/instagram/oauthState';
import { upsertInstagramSecret } from '@/lib/instagram/secrets';

const SETTINGS_PATH = '/settings/whatsapp';

function settingsRedirect(status: string): NextResponse {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return NextResponse.redirect(`${base}${SETTINGS_PATH}?instagram=${status}`);
}

/**
 * GET /api/auth/instagram/callback
 * Instagram redirects here with ?code & ?state (or ?error on denial).
 * Exchanges the code for a long-lived token, stores it against the tenant, and bounces
 * back to settings with a status flag. Owner-authenticated; cross-checks the signed
 * state's tenant id against the session.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in session');

    const params = new URL(ctx.request.url).searchParams;
    const error = params.get('error') || params.get('error_reason');
    const code = params.get('code');
    const state = params.get('state');

    // User declined on Instagram's screen.
    if (error) return settingsRedirect('denied');

    if (!code) return settingsRedirect('missing_code');

    // Signed state must be valid AND belong to the tenant in the current session.
    const stateTenant = verifyState(state);
    if (!stateTenant || stateTenant !== tenantId) return settingsRedirect('invalid_state');

    const cfg = getInstagramOAuthConfig();
    if (!cfg) return settingsRedirect('not_configured');

    try {
      const short = await exchangeCodeForToken(cfg, code);
      const long = await exchangeForLongLivedToken(cfg, short.accessToken);
      const tokenExpiresAt = new Date(Date.now() + long.expiresIn * 1000).toISOString();

      // Service-role client: whatsapp_provider_secrets is service-role-only (RLS).
      const admin = createSupabaseAdminClient();
      await upsertInstagramSecret(admin, tenantId, {
        accessToken: long.accessToken,
        igId: short.userId,
        tokenExpiresAt,
      });

      return settingsRedirect('connected');
    } catch (e) {
      defaultLogger.error('[instagram/callback] token exchange/storage failed', e);
      return settingsRedirect('error');
    }
  },
  'GET',
  { auth: true, roles: ['owner'] }
);
