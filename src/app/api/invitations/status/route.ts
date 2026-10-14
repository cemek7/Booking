import { parse } from 'cookie';
import { NextRequest, NextResponse } from 'next/server';
import {
  INVITATION_COOKIE_NAME,
  isValidInvitationToken,
} from '@/lib/auth/invitation-cookie';
import {
  hashInvitationToken,
  maskInvitationEmail,
  normalizeInvitationEmail,
} from '@/lib/auth/tenant-invitations';
import {
  createSupabaseAdminClient,
  getSupabaseRouteHandlerClient,
} from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type InvitationStatusRow = {
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  tenant_id: string;
  tenants: { id: string; name: string | null } | Array<{ id: string; name: string | null }> | null;
};

function noStoreJson(body: Record<string, unknown>): NextResponse {
  const response = NextResponse.json(body);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function invalidStatus(): NextResponse {
  return noStoreJson({ valid: false });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawToken = parse(request.headers.get('cookie') ?? '')[INVITATION_COOKIE_NAME];
  if (!isValidInvitationToken(rawToken)) return invalidStatus();

  const { data, error } = await createSupabaseAdminClient()
    .from('tenant_invitations')
    .select('email, role, expires_at, accepted_at, revoked_at, tenant_id, tenants(id, name)')
    .eq('token_hash', hashInvitationToken(rawToken))
    .maybeSingle();
  const invitation = data as InvitationStatusRow | null;
  const expiresAt = invitation ? new Date(invitation.expires_at) : null;

  if (
    error ||
    !invitation ||
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now() ||
    invitation.accepted_at !== null ||
    invitation.revoked_at !== null ||
    (invitation.role !== 'manager' && invitation.role !== 'staff')
  ) {
    return invalidStatus();
  }

  const tenant = Array.isArray(invitation.tenants)
    ? invitation.tenants[0]
    : invitation.tenants;
  if (!tenant) return invalidStatus();

  let user: { email?: string | null } | null = null;
  try {
    const result = await getSupabaseRouteHandlerClient().auth.getUser();
    if (!result.error) user = result.data.user;
  } catch {
    user = null;
  }

  return noStoreJson({
    valid: true,
    tenant: { id: tenant.id, name: tenant.name ?? 'Booka workspace' },
    role: invitation.role,
    masked_email: maskInvitationEmail(invitation.email),
    expires_at: invitation.expires_at,
    authenticated: Boolean(user),
    email_matches: user
      ? normalizeInvitationEmail(user.email ?? '') === normalizeInvitationEmail(invitation.email)
      : null,
  });
}
