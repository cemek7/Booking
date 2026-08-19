export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { getInstagramOAuthConfig, buildAuthorizeUrl } from '@/lib/instagram/oauthClient';
import { signState } from '@/lib/instagram/oauthState';

/**
 * GET /api/auth/instagram/start
 * Owner-initiated. Redirects the browser to Instagram's authorization screen with a
 * signed `state` bound to the tenant. Link a "Connect Instagram" button straight to this.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in session');

    const cfg = getInstagramOAuthConfig();
    if (!cfg) {
      // Not configured yet (Meta app setup pending) — fail loud, don't half-redirect.
      throw ApiErrorFactory.internalServerError(new Error('Instagram OAuth not configured'));
    }

    const state = signState(tenantId);
    return NextResponse.redirect(buildAuthorizeUrl(cfg, state));
  },
  'GET',
  { auth: true, roles: ['owner'] }
);
