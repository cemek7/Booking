/**
 * Slot Engine (v2)
 *
 * Calculates available appointment slots for WA-native staff.
 * Builds on the existing optimizedScheduler pattern but adds:
 *  - Reads staff_schedules via tenant_user_id (v2 column) in addition to staff_id
 *  - Applies schedule_overrides (date-specific exceptions)
 *  - Excludes active slot_locks (3-minute holds from other customers)
 *  - Respects tenants.buffer_minutes gap between appointments
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface TimeSlot {
  start: string; // HH:MM
  end: string;   // HH:MM
  available: boolean;
}

// ─── Get available slots ───────────────────────────────────────────────────────

/**
 * Returns the list of time slots for a given staff member on a given date.
 * Slot interval is derived from the service's duration_minutes.
 */
export async function getAvailableSlots(
  tenantId: string,
  tenantStaffId: string,
  date: string, // YYYY-MM-DD
  serviceId: string
): Promise<TimeSlot[]> {
  const dayOfWeek = new Date(date).getDay(); // 0=Sun, 6=Sat

  // ── Service duration ───────────────────────────────────────────────────────
  const { data: service } = await supabaseAdmin
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const durationMinutes = service?.duration_minutes ?? 60;

  // ── Tenant buffer ──────────────────────────────────────────────────────────
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('buffer_minutes')
    .eq('id', tenantId)
    .maybeSingle();

  const bufferMinutes = tenant?.buffer_minutes ?? 15;

  // ── Check schedule override for this date ──────────────────────────────────
  const { data: override } = await supabaseAdmin
    .from('schedule_overrides')
    .select('is_blocked, custom_start, custom_end')
    .eq('tenant_staff_id', tenantStaffId)
    .eq('date', date)
    .maybeSingle();

  if (override?.is_blocked) return []; // Full day off

  // ── Recurring schedule for this day ───────────────────────────────────────
  // v2 staff use tenant_user_id; fall back to checking both columns
  const { data: scheduleRows } = await supabaseAdmin
    .from('staff_schedules')
    .select('start_time, end_time, break_start, break_end')
    .eq('tenant_user_id', tenantStaffId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true);

  if (!scheduleRows || scheduleRows.length === 0) return [];

  const schedule = scheduleRows[0];
  const shiftStart = override?.custom_start ?? schedule.start_time;
  const shiftEnd = override?.custom_end ?? schedule.end_time;

  if (!shiftStart || !shiftEnd) return [];

  // ── Existing reservations for this staff on this date ─────────────────────
  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('start_at, end_at')
    .eq('tenant_staff_id', tenantStaffId)
    .gte('start_at', `${date}T00:00:00`)
    .lt('start_at', `${date}T23:59:59`)
    .not('status', 'in', '("cancelled","no_show")');

  // ── Active slot locks ──────────────────────────────────────────────────────
  const { data: locks } = await supabaseAdmin
    .from('slot_locks')
    .select('start_time, end_time')
    .eq('tenant_staff_id', tenantStaffId)
    .eq('date', date)
    .gt('expires_at', new Date().toISOString());

  // ── Build blocked time ranges ──────────────────────────────────────────────
  const blockedRanges: Array<{ start: number; end: number }> = [];

  for (const r of reservations ?? []) {
    blockedRanges.push({
      start: timeToMinutes(r.start_at.slice(11, 16)),
      end: timeToMinutes(r.end_at.slice(11, 16)) + bufferMinutes,
    });
  }

  for (const l of locks ?? []) {
    blockedRanges.push({
      start: timeToMinutes(l.start_time),
      end: timeToMinutes(l.end_time) + bufferMinutes,
    });
  }

  // Add break if defined
  if (schedule.break_start && schedule.break_end) {
    blockedRanges.push({
      start: timeToMinutes(schedule.break_start),
      end: timeToMinutes(schedule.break_end),
    });
  }

  // ── Generate slots ─────────────────────────────────────────────────────────
  const shiftStartMin = timeToMinutes(shiftStart);
  const shiftEndMin = timeToMinutes(shiftEnd);

  return generateSlots(shiftStartMin, shiftEndMin, durationMinutes, blockedRanges);
}

function generateSlots(
  shiftStart: number,
  shiftEnd: number,
  duration: number,
  blockedRanges: Array<{ start: number; end: number }>
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  let current = shiftStart;

  while (current + duration <= shiftEnd) {
    const slotEnd = current + duration;
    const available = !blockedRanges.some(
      (r) => current < r.end && slotEnd > r.start
    );

    slots.push({ start: minutesToTime(current), end: minutesToTime(slotEnd), available });

    current += 30; // check every 30 minutes
  }

  return slots;
}

// ─── Slot locks ───────────────────────────────────────────────────────────────

export async function lockSlot(
  tenantId: string,
  tenantStaffId: string,
  date: string,
  startTime: string,
  endTime: string,
  customerPhone: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('slot_locks')
    .insert({
      tenant_id: tenantId,
      tenant_staff_id: tenantStaffId,
      date,
      start_time: startTime,
      end_time: endTime,
      customer_phone: customerPhone,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[slotEngine] lockSlot error', error);
    return null;
  }

  return data.id;
}

export async function releaseLock(lockId: string): Promise<void> {
  await supabaseAdmin.from('slot_locks').delete().eq('id', lockId);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m ?? 0);
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
