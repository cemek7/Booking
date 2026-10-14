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
