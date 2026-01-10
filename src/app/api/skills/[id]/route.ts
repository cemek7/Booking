import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateTenantAccess, auditSuperadminAction } from '@/lib/enhanced-rbac';

// PATCH /api/skills/:id { name?, category? }
// DELETE /api/skills/:id

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 });
  
  const supabase = createServerSupabaseClient();
  
  // Authentication required
  const auth = req.headers.get('authorization') || '';
  const token = auth.split(' ')[1] || '';
  if (!token) return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
  
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  
  const actorId = userData.user.id;
  const actorEmail = userData.user.email || null;

  // Get skill to find tenant_id
  const { data: skillData } = await supabase.from('skills').select('tenant_id').eq('id', id).maybeSingle();
  if (!skillData?.tenant_id) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

  // Validate tenant access - require management permissions
  const validation = await validateTenantAccess(supabase, actorId, skillData.tenant_id, actorEmail);
  if (!validation.hasManagementAccess && !validation.isSuperadmin) {
    return NextResponse.json({ error: 'Insufficient permissions to modify skills' }, { status: 403 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.category === 'string') patch.category = body.category.trim();
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  
  // Audit superadmin actions
  if (validation.isSuperadmin) {
    await auditSuperadminAction(supabase, actorId, actorEmail, 'UPDATE_SKILL', {
      tenantId: skillData.tenant_id,
      skillId: id,
      updates: patch
    });
  }
  
  try {
    const { data, error } = await supabase.from('skills').update(patch).eq('id', id).select().maybeSingle();
    if (error) return NextResponse.json({ error: 'skill_update_failed' }, { status: 500 });
    return NextResponse.json({ skill: data });
  } catch (e) {
    return NextResponse.json({ error: 'skill_update_error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 });
  
  const supabase = createServerSupabaseClient();
  
  // Authentication required
  const auth = req.headers.get('authorization') || '';
  const token = auth.split(' ')[1] || '';
  if (!token) return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
  
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  
  const actorId = userData.user.id;
  const actorEmail = userData.user.email || null;

  // Get skill to find tenant_id
  const { data: skillData } = await supabase.from('skills').select('tenant_id').eq('id', id).maybeSingle();
  if (!skillData?.tenant_id) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

  // Validate tenant access - require management permissions
  const validation = await validateTenantAccess(supabase, actorId, skillData.tenant_id, actorEmail);
  if (!validation.hasManagementAccess && !validation.isSuperadmin) {
    return NextResponse.json({ error: 'Insufficient permissions to delete skills' }, { status: 403 });
  }

  // Audit superadmin actions
  if (validation.isSuperadmin) {
    await auditSuperadminAction(supabase, actorId, actorEmail, 'DELETE_SKILL', {
      tenantId: skillData.tenant_id,
      skillId: id
    });
  }
  
  try {
    const { error } = await supabase.from('skills').delete().eq('id', id);
    if (error) return NextResponse.json({ error: 'skill_delete_failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'skill_delete_error' }, { status: 500 });
  }
}
