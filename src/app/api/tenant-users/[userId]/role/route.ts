import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// PATCH /api/tenant-users/:userId/role?tenant_id=... { role }
export async function PATCH(req: Request, { params }: { params: { userId: string } }) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id_required' }, { status: 400 });
  const { userId } = params;
  if (!userId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 });
  let body: { role?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (!body.role) return NextResponse.json({ error: 'role_required' }, { status: 400 });
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from('tenant_users')
      .update({ role: body.role })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (error) return NextResponse.json({ error: 'role_update_failed' }, { status: 500 });
    return NextResponse.json({ ok: true, userId, role: body.role });
  } catch (e: any) {
    return NextResponse.json({ error: 'role_update_error', detail: e?.message }, { status: 500 });
  }
}
