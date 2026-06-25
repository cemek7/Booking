import type { SupabaseClient } from '@supabase/supabase-js';

export async function getTeamSchedule(
  supabase: SupabaseClient,
  tenantId: string,
  range: { start: Date; end: Date },
  staffId?: string
) {
  let query = supabase
    .from('reservations')
    .select('id, staff_id, service_id, start_at, end_at, status, customer_name')
    .eq('tenant_id', tenantId)
    .gte('start_at', range.start.toISOString())
    .lte('end_at', range.end.toISOString())
    .not('status', 'in', '("cancelled")');

  if (staffId) {
    query = query.eq('staff_id', staffId);
  }

  const { data: bookings, error } = await query.order('start_at', { ascending: true });
  if (error) throw new Error(error.message);
  return { bookings: bookings ?? [] };
}

export async function createScheduleOverride(
  supabase: SupabaseClient,
  tenantId: string,
  data: { staff_id: string; date: string; available: boolean; reason?: string }
) {
  const { data: override, error } = await supabase
    .from('staff_schedule_overrides')
    .upsert({
      tenant_id: tenantId,
      staff_id: data.staff_id,
      date: data.date,
      available: data.available,
      reason: data.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id, staff_id, date, available')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { override };
}

export async function updateStaffAvailability(
  supabase: SupabaseClient,
  tenantId: string,
  data: { staff_id: string; schedule: unknown }
) {
  const { data: updated, error } = await supabase
    .from('tenant_users')
    .update({ availability: data.schedule, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('user_id', data.staff_id)
    .select('user_id, availability')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Staff member not found');
  return { updated };
}

export async function bulkUpdateSchedules(
  supabase: SupabaseClient,
  tenantId: string,
  data: Array<{ staff_id: string; schedule: unknown }>
) {
  const results = await Promise.allSettled(
    data.map((item) => updateStaffAvailability(supabase, tenantId, item))
  );

  const updated = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { updated, failed };
}
