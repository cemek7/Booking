import type { SupabaseClient } from '@supabase/supabase-js';

export async function getTeamData(supabase: SupabaseClient, tenantId: string) {
  const { data: members, error } = await supabase
    .from('tenant_users')
    .select('user_id, role, email, full_name, is_active, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return { members: members ?? [] };
}

export async function inviteTeamMember(
  supabase: SupabaseClient,
  tenantId: string,
  data: { email: string; role: string; full_name?: string }
) {
  const { data: existing } = await supabase
    .from('tenant_users')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('email', data.email)
    .maybeSingle();

  if (existing) throw new Error('User is already a member of this team');

  const { data: invited, error } = await supabase
    .from('tenant_users')
    .insert({
      tenant_id: tenantId,
      email: data.email,
      role: data.role,
      full_name: data.full_name ?? null,
      is_active: false,
    })
    .select('user_id, email, role')
    .single();

  if (error) throw new Error(error.message);
  return { invited };
}

export async function updateTeamMemberRole(
  supabase: SupabaseClient,
  tenantId: string,
  memberId: string,
  newRole: string
) {
  const { data: updated, error } = await supabase
    .from('tenant_users')
    .update({ role: newRole })
    .eq('tenant_id', tenantId)
    .eq('user_id', memberId)
    .select('user_id, role')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Team member not found');
  return { updated };
}

export async function setTeamMemberActiveStatus(
  supabase: SupabaseClient,
  tenantId: string,
  memberId: string,
  isActive: boolean
) {
  const { data: updated, error } = await supabase
    .from('tenant_users')
    .update({ is_active: isActive })
    .eq('tenant_id', tenantId)
    .eq('user_id', memberId)
    .select('user_id, is_active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Team member not found');
  return { updated };
}
