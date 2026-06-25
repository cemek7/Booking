export const dynamic = 'force-dynamic';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

type TenantMembership = {
  tenant_id: string;
  role: string;
  tenants?: {
    name?: string | null;
    slug?: string | null;
  } | null;
};

/**
 * POST /api/auth/admin-check
 *
 * Verifies the Bearer token, then returns:
 * - { found: { admin, email } }            — superadmin
 * - { found: { tenant_id, role } }         — single tenant member
 * - { found: { tenants: [...] } }          — multiple tenant memberships
 * - { found: null }                        — no membership (→ onboarding)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const admin = createSupabaseAdminClient();

    // Resolve identity from token; fall back to email lookup for legacy callers
    let userId: string | null = null;
    let userEmail: string | null = null;

    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user) {
        userId = data.user.id;
        userEmail = data.user.email ?? null;
      }
    }

    if (!userId) {
      const body = await request.json().catch(() => ({}));
      const { email } = body as { email?: string };
      if (!email) {
        return NextResponse.json({ found: null }, { status: 200 });
      }
      // Legacy: look up by email to get user_id
      const { data: authUser } = await admin
        .from('tenant_users')
        .select('user_id')
        .eq('email', email)
        .not('user_id', 'is', null)
        .limit(1)
        .maybeSingle();
      userId = authUser?.user_id ?? null;
      userEmail = email;
    }

    if (!userId) return NextResponse.json({ found: null }, { status: 200 });

    // Check superadmin
    const normalizedEmail = userEmail?.trim().toLowerCase() ?? '';
    const { data: adminRowByEmail } = normalizedEmail
      ? await admin
          .from('admins')
          .select('email, status')
          .eq('email', normalizedEmail)
          .maybeSingle()
      : { data: null };

    const adminRow = adminRowByEmail;

    if (adminRow) {
      return NextResponse.json({ found: { admin: true, email: adminRow.email ?? userEmail } });
    }

    // Fetch ALL tenant memberships for this user
    const { data: memberships, error: tuErr } = await admin
      .from('tenant_users')
      .select('tenant_id, role, tenants(name, slug)')
      .eq('user_id', userId);

    if (tuErr) {
      defaultLogger.error('[auth/admin-check] tenant_users query failed:', tuErr);
      return NextResponse.json({ found: null }, { status: 200 });
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ found: null }, { status: 200 });
    }

    if (memberships.length === 1) {
      const membership = memberships[0] as TenantMembership;
      return NextResponse.json({
        found: {
          tenant_id: membership.tenant_id,
          role: membership.role,
          user_id: userId,
          email: userEmail,
        },
      });
    }

    // Multiple tenants — return all for the picker
    return NextResponse.json({
      found: {
        multiple: true,
        user_id: userId,
        email: userEmail,
        tenants: (memberships as TenantMembership[]).map((m) => ({
          tenant_id: m.tenant_id,
          role: m.role,
          name: m.tenants?.name ?? null,
          slug: m.tenants?.slug ?? null,
        })),
      },
    });
  } catch (err) {
    defaultLogger.error('[auth/admin-check] unexpected error:', err);
    return NextResponse.json({ found: null }, { status: 200 });
  }
}
