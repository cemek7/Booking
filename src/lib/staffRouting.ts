import { createServerSupabaseClient } from '@/lib/supabase/server';
import scheduler from './scheduler';

export type RoutingStrategy = 'round_robin' | 'preferred' | 'skill_based';

interface StaffUser { user_id: string; role: string; preferred?: boolean | null; skills?: string[] | null; }

// Fetch staff list for tenant (optionally location scoped later)
async function fetchStaff(supabase: SupabaseClient, tenantId: string): Promise<StaffUser[]> {
  const { data, error } = await supabase.from('tenant_users').select('user_id, role').eq('tenant_id', tenantId).eq('role', 'staff');
  if (error || !Array.isArray(data)) return [];
  return data as StaffUser[];
}

// Round-robin: naive persistent pointer stored in kv table (platform_settings_kv) or fallback memory-less choice.
export async function pickRoundRobinStaff(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  const staff = await fetchStaff(supabase, tenantId);
  if (!staff.length) return null;
  try {
    const key = `rr_staff_${tenantId}`;
    const { data: kv } = await supabase.from('platform_settings_kv').select('value').eq('key', key).maybeSingle();
    const lastIdx = kv && kv.value && typeof kv.value.idx === 'number' ? kv.value.idx : -1;
    const nextIdx = (lastIdx + 1) % staff.length;
    // upsert
    await supabase.from('platform_settings_kv').upsert({ key, value: { idx: nextIdx } });
    return staff[nextIdx].user_id;
  } catch {
    // fallback random
    return staff[Math.floor(Math.random() * staff.length)].user_id;
  }
}

// Preferred: choose staff with least upcoming conflicts (uses scheduler.findFreeStaff for current time range)
export async function pickPreferredStaff(supabase: SupabaseClient, tenantId: string, startIso: string, endIso: string): Promise<string | null> {
  const free = await scheduler.findFreeStaff(supabase, tenantId, startIso, endIso);
  if (!free.length) return null;
  // Basic heuristic: first free staff
  return free[0].user_id;
}

// Skill-based: placeholder - would check a staff_skills table. Currently falls back to preferred logic.
export async function pickSkillBasedStaff(
  supabase: SupabaseClient,
  tenantId: string,
  requiredSkill: string | null,
  startIso: string,
  endIso: string
): Promise<string | null> {
  if (!requiredSkill) return await pickPreferredStaff(supabase, tenantId, startIso, endIso);
  // Fetch free staff first
  const free = await scheduler.findFreeStaff(supabase, tenantId, startIso, endIso);
  if (!free.length) return null;
  const freeIds = new Set(free.map(f => f.user_id));
  // Fetch staff skilled in requiredSkill
  const { data: skilled, error } = await supabase
    .from('staff_skills')
    .select('user_id, skill_name')
    .eq('tenant_id', tenantId)
    .eq('skill_name', requiredSkill);
  if (error || !skilled) return await pickPreferredStaff(supabase, tenantId, startIso, endIso);
  const candidates = skilled.filter(s => freeIds.has(s.user_id));
  if (!candidates.length) return await pickPreferredStaff(supabase, tenantId, startIso, endIso);
  // Simple heuristic: choose first skilled free staff
  return candidates[0].user_id;
}

export async function routeStaff(
  supabase: SupabaseClient,
  tenantId: string,
  strategy: RoutingStrategy,
  startIso: string,
  endIso: string,
  opts: { requiredSkill?: string | null } = {}
): Promise<string | null> {
  switch (strategy) {
    case 'round_robin':
      return await pickRoundRobinStaff(supabase, tenantId);
    case 'skill_based':
      return await pickSkillBasedStaff(supabase, tenantId, opts.requiredSkill || null, startIso, endIso);
    case 'preferred':
    default:
      return await pickPreferredStaff(supabase, tenantId, startIso, endIso);
  }
}

export default { routeStaff, pickRoundRobinStaff, pickPreferredStaff, pickSkillBasedStaff };
