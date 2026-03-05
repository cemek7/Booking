import { SupabaseClient } from '@supabase/supabase-js';

/** Details required to create a one-off schedule override for a staff member. */
export interface ScheduleOverrideDetails {
  staffId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  overrideType: 'unavailable' | 'extended' | 'reduced';
  startTime?: string; // HH:mm
  endTime?: string;   // HH:mm
  reason?: string;
}

/** Details required to update a staff member's recurring availability. */
export interface AvailabilityDetails {
  staffId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  isAvailable: boolean;
}

/** A single schedule update item used by bulkUpdateSchedules. */
export interface ScheduleUpdate {
  staffId: string;
  date: string; // ISO date string
  changes: Partial<AvailabilityDetails>;
}

export async function getTeamSchedule(
  supabase: SupabaseClient,
  tenantId: string,
  dateRange: { start: Date; end: Date },
  staffId?: string
) {
  // Implementation to be filled
  return { teamMembers: [], bookings: [], availability: [] };
}

export async function createScheduleOverride(
  supabase: SupabaseClient,
  tenantId: string,
  overrideDetails: ScheduleOverrideDetails
) {
  // Implementation to be filled
  return { override: {} };
}

export async function updateStaffAvailability(
  supabase: SupabaseClient,
  tenantId: string,
  availabilityDetails: AvailabilityDetails
) {
  // Implementation to be filled
  return { availability: {} };
}

export async function bulkUpdateSchedules(
  supabase: SupabaseClient,
  tenantId: string,
  updates: ScheduleUpdate[]
) {
  // Implementation to be filled
  return { updated: 0 };
}
