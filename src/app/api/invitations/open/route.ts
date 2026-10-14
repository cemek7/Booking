import { NextRequest, NextResponse } from 'next/server';
import { serialize } from 'cookie';
import {
  INVITATION_COOKIE_NAME,
  buildInvitationCookieOptions,
  isValidInvitationToken,
} from '@/lib/auth/invitation-cookie';
import { hashInvitationToken } from '@/lib/auth/tenant-invitations';
import { getPublicOrigin } from '@/lib/http/public-origin';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type InvitationRow = {
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

function redirectWithoutReferrer(request: NextRequest, path: string): NextResponse {
  const location = new URL(path, getPublicOrigin(request)).toString();
  const response = NextResponse.redirect(location);
  response.headers.set('Location', location);
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawToken = request.nextUrl.searchParams.get('token');
  if (!isValidInvitationToken(rawToken)) {
    return redirectWithoutReferrer(request, '/invitation-invalid');
  }

  const tokenHash = hashInvitationToken(rawToken);
  const { data, error } = await createSupabaseAdminClient()
    .from('tenant_invitations')
    .select('expires_at, accepted_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  const invitation = data as InvitationRow | null;
  const expiresAt = invitation ? new Date(invitation.expires_at) : null;

  if (
    error ||
    !invitation ||
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now() ||
    invitation.accepted_at !== null ||
    invitation.revoked_at !== null
  ) {
    return redirectWithoutReferrer(request, '/invitation-invalid');
  }

  const response = redirectWithoutReferrer(request, '/accept-invite');
  response.headers.set('Set-Cookie', serialize(
    INVITATION_COOKIE_NAME,
    rawToken,
    buildInvitationCookieOptions(invitation.expires_at)
  ));
  return response;
}
