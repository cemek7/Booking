import type { SupabaseClient } from '@supabase/supabase-js';

export async function getStaffData(supabase: SupabaseClient, tenantId: string) {
  const { data: staff, error } = await supabase
    .from('tenant_users')
    .select('user_id, role, email, full_name, is_active, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return { staff: staff ?? [] };
}

export async function inviteStaffMember(
  supabase: SupabaseClient,
  tenantId: string,
  data: { email: string; role: string; fullName?: string }
) {
  // Check for existing membership
  const { data: existing } = await supabase
    .from('tenant_users')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('email', data.email)
    .maybeSingle();

  if (existing) throw new Error('User is already a member of this tenant');

  const { data: invited, error } = await supabase
    .from('tenant_users')
    .insert({
      tenant_id: tenantId,
      email: data.email,
      role: data.role,
      full_name: data.fullName ?? null,
      is_active: false, // pending acceptance
    })
    .select('user_id, email, role')
    .single();

  if (error) throw new Error(error.message);
  return { invited };
}

export async function updateStaffMember(
  supabase: SupabaseClient,
  tenantId: string,
  staffId: string,
  data: { role?: string; active?: boolean }
) {
  const updates: Record<string, unknown> = {};
  if (data.role !== undefined) updates.role = data.role;
  if (data.active !== undefined) updates.is_active = data.active;

  const { data: updated, error } = await supabase
    .from('tenant_users')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('user_id', staffId)
    .select('user_id, role, is_active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Staff member not found');
  return { updated };
}

export async function removeStaffMember(
  supabase: SupabaseClient,
  tenantId: string,
  staffId: string
) {
  const { error } = await supabase
    .from('tenant_users')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', staffId);

  if (error) throw new Error(error.message);
  return { removed: true };
}
