/**
 * Basic scheduler helpers (stubs with simple implementations).
 * These are intentionally minimal and can be improved with staff shift tables
 * and more advanced availability rules.
 */
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface FreeSlot {
  start_at: string;
  end_at: string;
}

// findFreeSlot: naive search between from..to for the first slot of durationMinutes that has no overlapping reservations
export async function findFreeSlot(
  supabase: SupabaseClient,
  tenantId: string,
  fromIso: string,
  toIso: string,
  durationMinutes = 60
): Promise<FreeSlot | null> {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const step = 15 * 60 * 1000; // 15 minutes steps
  for (let ts = from; ts + durationMinutes * 60 * 1000 <= to; ts += step) {
    const s = new Date(ts).toISOString();
    const e = new Date(ts + durationMinutes * 60 * 1000).toISOString();
    // check overlap
    const { data: respData, error: respErr } = await supabase
      .from('reservations')
      .select('id')
      .eq('tenant_id', tenantId)
      .lt('start_at', e)
      .gt('end_at', s)
      .limit(1);
    if (respErr) {
      console.warn('findFreeSlot overlap check failed', respErr);
      // If overlap check fails unexpectedly, skip this slot and continue
      continue;
    }
    const conflicts = Array.isArray(respData) ? respData : [];
    if (conflicts.length === 0) return { start_at: s, end_at: e };
  }
  return null;
}

export interface StaffRow {
  user_id: string;
  role: string;
}

// findFreeStaff: naive implementation returns staff without an overlapping reservation at that slot
export async function findFreeStaff(
  supabase: SupabaseClient,
  tenantId: string,
  startIso: string,
  endIso: string
): Promise<StaffRow[]> {
  try {
    const { data: staffData, error: staffErr } = await supabase.from('tenant_users').select('user_id,role').eq('tenant_id', tenantId).eq('role', 'staff');
    if (staffErr) {
      console.warn('findFreeStaff tenant_users fetch failed', staffErr);
      return [];
    }
    const staff = Array.isArray(staffData) ? (staffData as StaffRow[]) : [];
    if (!Array.isArray(staff) || staff.length === 0) return [];
    const out: StaffRow[] = [];
    for (const s of staff) {
      const uid = s.user_id;
      const { data: rdata, error: rerr } = await supabase.from('reservations').select('id').eq('tenant_id', tenantId).eq('staff_id', uid).lt('start_at', endIso).gt('end_at', startIso).limit(1);
      if (rerr) {
        console.warn('findFreeStaff reservation lookup failed for user', uid, rerr);
        continue;
      }
      const conflicts = Array.isArray(rdata) ? rdata : [];
      if (conflicts.length === 0) out.push(s);
    }
    return out;
  } catch (err: unknown) {
    console.warn('findFreeStaff error', err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function nextAvailableSlot(
  supabase: SupabaseClient,
  tenantId: string,
  fromIso: string,
  durationMinutes = 60,
  daysLookahead = 14
): Promise<FreeSlot | null> {
  const from = new Date(fromIso);
  const to = new Date(from.getTime() + daysLookahead * 24 * 60 * 60 * 1000);
  return await findFreeSlot(supabase, tenantId, from.toISOString(), to.toISOString(), durationMinutes);
}

const scheduler = { findFreeSlot, findFreeStaff, nextAvailableSlot };
export default scheduler;
