import { parse, serialize } from 'cookie';
import { NextResponse } from 'next/server';
import {
  INVITATION_COOKIE_NAME,
  isValidInvitationToken,
} from '@/lib/auth/invitation-cookie';
import {
  hashInvitationToken,
  normalizeInvitationEmail,
} from '@/lib/auth/tenant-invitations';
import { ApiError } from '@/lib/error-handling/api-error';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ACCEPTANCE_ERROR_STATUS: Record<string, number> = {
  invite_invalid: 400,
  invite_expired: 410,
  invite_consumed: 409,
  invite_email_mismatch: 403,
  invite_membership_conflict: 409,
};

type AcceptanceRow = {
  tenant_id: string;
  role: 'manager' | 'staff';
};

function acceptanceError(error: unknown): ApiError {
  const message = typeof error === 'object' && error && 'message' in error
    ? String(error.message)
    : '';
  const code = Object.prototype.hasOwnProperty.call(ACCEPTANCE_ERROR_STATUS, message.trim())
    ? message.trim()
    : 'invite_invalid';
  return new ApiError(code, 'Unable to accept this invitation', ACCEPTANCE_ERROR_STATUS[code]);
}

export const POST = createHttpHandler(
  async (ctx) => {
    const rawToken = parse(ctx.request.headers.get('cookie') ?? '')[INVITATION_COOKIE_NAME];
    if (!isValidInvitationToken(rawToken)) throw acceptanceError(null);

    const email = normalizeInvitationEmail(ctx.user?.email ?? '');
    if (!email) throw acceptanceError(null);

    const { data, error } = await createSupabaseAdminClient().rpc(
      'accept_tenant_invitation',
      {
        p_token_hash: hashInvitationToken(rawToken),
        p_user_id: ctx.user!.id,
        p_user_email: email,
      }
    );
    if (error) throw acceptanceError(error);

    const row = (Array.isArray(data) ? data[0] : data) as AcceptanceRow | null;
    if (!row || (row.role !== 'manager' && row.role !== 'staff')) {
      throw acceptanceError(null);
    }

    const response = NextResponse.json({
      ok: true,
      tenant_id: row.tenant_id,
      role: row.role,
      redirect_to: row.role === 'staff' ? '/dashboard/staff-dashboard' : '/dashboard',
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Set-Cookie', serialize(INVITATION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    }));
    return response;
  },
  'POST',
  { auth: true, requireTenantMembership: false }
);
