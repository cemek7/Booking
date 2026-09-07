export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiError, ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import {
  getInstagramOAuthConfig,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
} from '@/lib/instagram/oauthClient';
import { verifyState } from '@/lib/instagram/oauthState';
import { upsertInstagramSecret } from '@/lib/instagram/secrets';

const SETTINGS_PATH = '/dashboard/settings';

function settingsRedirect(status: string): NextResponse {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return NextResponse.redirect(`${base}${SETTINGS_PATH}?tab=whatsapp&instagram=${status}`);
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
    const params = new URL(ctx.request.url).searchParams;
    const error = params.get('error') || params.get('error_reason');
    const code = params.get('code');
    const state = params.get('state');

    // User declined on Instagram's screen.
    if (error) return settingsRedirect('denied');

    if (!code) return settingsRedirect('missing_code');

    // Signed state identifies the tenant; authenticated owner membership is
    // validated server-side below.
    const tenantId = verifyState(state);
    if (!tenantId) return settingsRedirect('invalid_state');

    const userId = ctx.user?.id;
    if (!userId) throw ApiErrorFactory.forbidden('No authenticated user');

    // Meta's callback is a top-level browser navigation and cannot carry Booka's
    // x-tenant-id header. Resolve the signed tenant from OAuth state, then enforce
    // owner membership server-side before exchanging or storing any token.
    const admin = createSupabaseAdminClient();
    const { data: membership, error: membershipError } = await admin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (membershipError || membership?.role !== 'owner') {
      throw ApiErrorFactory.forbidden('Instagram connection requires tenant owner access');
    }

    // Preserve the standard authenticated-route lifecycle gate even though this
    // callback resolves tenant scope from signed state instead of a request header.
    // As with the shared gate, lookup failures fail open, but a known locked tenant
    // cannot connect or replace Meta credentials.
    try {
      const { data: tenantRow } = await admin
        .from('tenants')
        .select('lifecycle_state')
        .eq('id', tenantId)
        .maybeSingle();
      const lifecycleState = (tenantRow as { lifecycle_state?: string } | null)?.lifecycle_state;
      if (lifecycleState && lifecycleState !== 'active') {
        throw new ApiError(
          'tenant_locked',
          'Tenant is being off-boarded. Only export and reactivation are permitted.',
          423,
        );
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 423) throw error;
      defaultLogger.warn('[instagram/callback] lifecycle check skipped (fail-open)', error);
    }

    const cfg = getInstagramOAuthConfig();
    if (!cfg) return settingsRedirect('not_configured');

    try {
      const short = await exchangeCodeForToken(cfg, code);
      const long = await exchangeForLongLivedToken(cfg, short.accessToken);
      const tokenExpiresAt = new Date(Date.now() + long.expiresIn * 1000).toISOString();

      // Service-role client: whatsapp_provider_secrets is service-role-only (RLS).
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
  { auth: true, requireTenantMembership: false }
);
