import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function getAnonClient() {
  return createServerSupabaseClient();
}

// POST /api/tenants/:tenantId/invites { email, role? }
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  if (!tenantId) return NextResponse.json({ error: 'tenant_id_required' }, { status: 400 });
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const email = (body?.email || '').trim().toLowerCase();
  const invitedRole = (body?.role || 'staff').toLowerCase();
  if (!email) return NextResponse.json({ error: 'email_required' }, { status: 400 });

  // Authenticate caller via Authorization header OR Supabase session cookie fallback.
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  let token: string | null = null;
  if (auth && auth.startsWith('Bearer ')) token = auth.slice('Bearer '.length);

  try {
    const anon = getAnonClient();
    let userId: string | null = null;
    if (token) {
      const { data: userRes, error: userErr } = await anon.auth.getUser(token);
      if (!userErr && userRes?.user) userId = userRes.user.id;
    }
    // Cookie-based fallback: attempt server client to retrieve user from session
    if (!userId) {
      // Try to read access token from Supabase cookie and resolve user
      try {
        const cookieStore = await cookies();
        const access = cookieStore.get('sb-access-token')?.value || cookieStore.get('sb:token')?.value;
        if (access) {
          const { data: userRes2 } = await anon.auth.getUser(access);
          if (userRes2?.user?.id) userId = userRes2.user.id;
        }
      } catch {}
    }
    if (!userId) {
      try {
        const server = createServerSupabaseClient();
        const { data: session } = await server.auth.getSession();
        if (session?.session?.user?.id) userId = session.session.user.id;
      } catch {}
    }
    if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const supabase = createServerSupabaseClient();
    // Fetch caller role in this tenant
    const { data: tu, error: tuErr } = await supabase
      .from('tenant_users')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();
    if (tuErr || !tu) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const callerRole = (tu.role || '').toLowerCase();

    // Load settings to check inviter permissions
    const { data: t, error: tErr } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();
    if (tErr) return NextResponse.json({ error: 'settings_fetch_failed' }, { status: 500 });
    const s = (t?.settings || {}) as any;
    const allowed: string[] = Array.isArray(s.allowedInviterRoles) ? s.allowedInviterRoles.map((x: string) => String(x).toLowerCase()) : ['owner','manager'];
    const allowFromStaff = s.allowInvitesFromStaffPage !== false;
    if (!allowed.includes(callerRole) || !allowFromStaff) {
      return NextResponse.json({ error: 'invites_not_allowed' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRole) {
      // Dev fallback: pretend success without persistence
      const fakeToken = `dev-${crypto.randomUUID()}`;
      return NextResponse.json({ ok: true, token: fakeToken, url: `/accept-invite?token=${encodeURIComponent(fakeToken)}`, devFallback: true });
    }
    // Create invite token row
    const tokenValue = crypto.randomUUID();
    const { error: insErr } = await supabase
      .from('invites')
      .insert({ token: tokenValue, tenant_id: tenantId, email, role: invitedRole });
    if (insErr) return NextResponse.json({ error: 'invite_create_failed', detail: insErr.message }, { status: 500 });
    const inviteUrl = `/accept-invite?token=${encodeURIComponent(tokenValue)}`;
    return NextResponse.json({ ok: true, token: tokenValue, url: inviteUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.includes('Supabase URL/anon key missing') || msg.includes('SUPABASE_URL')) {
      // Dev fallback when env totally missing
      const fakeToken = `dev-${crypto.randomUUID()}`;
      return NextResponse.json({ ok: true, token: fakeToken, url: `/accept-invite?token=${encodeURIComponent(fakeToken)}`, devFallback: true });
    }
    return NextResponse.json({ error: 'invite_error', detail: msg }, { status: 500 });
  }
}
