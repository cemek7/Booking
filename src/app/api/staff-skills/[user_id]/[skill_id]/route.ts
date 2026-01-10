import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateTenantAccess, auditSuperadminAction } from '@/lib/enhanced-rbac';

// DELETE /api/staff-skills/:user_id/:skill_id -> unassign skill
export async function DELETE(req: Request, { params }: { params: { user_id: string; skill_id: string } }) {
  const { user_id, skill_id } = params;
  if (!user_id || !skill_id) return NextResponse.json({ error: 'user_id_and_skill_id_required' }, { status: 400 });
  
  const supabase = createServerSupabaseClient();
  
  // Authentication required
  const auth = req.headers.get('authorization') || '';
  const token = auth.split(' ')[1] || '';
  if (!token) return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
  
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  
  const actorId = userData.user.id;
  const actorEmail = userData.user.email || null;

  // Get staff skill to find tenant_id
  const { data: skillAssignment } = await supabase
    .from('staff_skills')
    .select('tenant_id')
    .eq('user_id', user_id)
    .eq('skill_id', skill_id)
    .maybeSingle();
    
  if (!skillAssignment?.tenant_id) {
    return NextResponse.json({ error: 'Skill assignment not found' }, { status: 404 });
  }

  // Validate tenant access - require management permissions
  const validation = await validateTenantAccess(supabase, actorId, skillAssignment.tenant_id, actorEmail);
  if (!validation.hasManagementAccess && !validation.isSuperadmin) {
    return NextResponse.json({ error: 'Insufficient permissions to manage staff skills' }, { status: 403 });
  }

  // Audit superadmin actions
  if (validation.isSuperadmin) {
    await auditSuperadminAction(supabase, actorId, actorEmail, 'UNASSIGN_STAFF_SKILL', {
      tenantId: skillAssignment.tenant_id,
      staffUserId: user_id,
      skillId: skill_id
    });
  }
  try {
    const { error } = await supabase.from('staff_skills').delete().eq('user_id', user_id).eq('skill_id', skill_id);
    if (error) return NextResponse.json({ error: 'staff_skill_unassign_failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'staff_skill_unassign_error' }, { status: 500 });
  }
}
