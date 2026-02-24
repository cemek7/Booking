/**
 * Business Hours Helper
 * 
 * Fetches and formats business hours from database for WhatsApp messages
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

interface BusinessHour {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_open: boolean;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Fetch business hours from database and format for WhatsApp message
 */
export async function getBusinessHoursMessage(tenantId: string): Promise<string> {
  const supabase = createServerSupabaseClient();

  try {
    const { data: hours, error } = await supabase
      .from('business_hours')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('day_of_week', { ascending: true });

    if (error || !hours || hours.length === 0) {
      // Fallback to default message if no hours configured
      return getDefaultBusinessHoursMessage();
    }

    return formatBusinessHours(hours as BusinessHour[]);
  } catch (error) {
    console.error('[BusinessHours] Error fetching hours:', error);
    return getDefaultBusinessHoursMessage();
  }
}

/**
 * Format business hours array into readable message
 */
function formatBusinessHours(hours: BusinessHour[]): string {
  const lines: string[] = ["We're open:"];
  lines.push('');

  // Group consecutive days with same hours
  const groups = groupConsecutiveDays(hours);

  groups.forEach(group => {
    if (!group.is_open) {
      lines.push(`📅 ${group.days}: Closed`);
    } else {
      const start = formatTime(group.start_time);
      const end = formatTime(group.end_time);
      lines.push(`📅 ${group.days}: ${start} - ${end}`);
    }
  });

  return lines.join('\n');
}

/**
 * Group consecutive days with same hours
 */
function groupConsecutiveDays(hours: BusinessHour[]): Array<{
  days: string;
  is_open: boolean;
  start_time: string;
  end_time: string;
}> {
  const groups: Array<{
    days: string;
    is_open: boolean;
    start_time: string;
    end_time: string;
  }> = [];

  let currentGroup: BusinessHour[] = [];

  hours.forEach((hour, index) => {
    if (currentGroup.length === 0) {
      currentGroup.push(hour);
    } else {
      const lastHour = currentGroup[currentGroup.length - 1];
      
      // Check if same hours as previous day
      if (
        lastHour.is_open === hour.is_open &&
        lastHour.start_time === hour.start_time &&
        lastHour.end_time === hour.end_time &&
        lastHour.day_of_week + 1 === hour.day_of_week
      ) {
        currentGroup.push(hour);
      } else {
        // Different hours, finalize current group
        groups.push(formatGroup(currentGroup));
        currentGroup = [hour];
      }
    }

    // Last item - finalize group
    if (index === hours.length - 1) {
      groups.push(formatGroup(currentGroup));
    }
  });

  return groups;
}

/**
 * Format a group of consecutive days
 */
function formatGroup(group: BusinessHour[]): {
  days: string;
  is_open: boolean;
  start_time: string;
  end_time: string;
} {
  if (group.length === 0) {
    return { days: '', is_open: false, start_time: '', end_time: '' };
  }

  const first = group[0];
  const last = group[group.length - 1];

  let daysStr: string;
  if (group.length === 1) {
    daysStr = DAY_NAMES[first.day_of_week];
  } else if (group.length === 2) {
    daysStr = `${DAY_NAMES[first.day_of_week]} and ${DAY_NAMES[last.day_of_week]}`;
  } else {
    daysStr = `${DAY_NAMES[first.day_of_week]} - ${DAY_NAMES[last.day_of_week]}`;
  }

  return {
    days: daysStr,
    is_open: first.is_open,
    start_time: first.start_time,
    end_time: first.end_time
  };
}

/**
 * Format time from HH:MM:SS to 12-hour format
 */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}${minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''} ${period}`;
}

/**
 * Default fallback message if no hours configured
 */
function getDefaultBusinessHoursMessage(): string {
  return `We're open:\n\n📅 Monday - Friday: 9 AM - 6 PM\n📅 Saturday: 10 AM - 4 PM\n📅 Sunday: Closed`;
}

/**
 * Check if currently within business hours
 */
export async function isWithinBusinessHours(tenantId: string): Promise<boolean> {
  const supabase = createServerSupabaseClient();
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:00`;

  try {
    const { data: hour, error } = await supabase
      .from('business_hours')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('day_of_week', dayOfWeek)
      .single();

    if (error || !hour) {
      // Default to open if no hours configured
      return true;
    }

    return hour.is_open && currentTime >= hour.start_time && currentTime <= hour.end_time;
  } catch (error) {
    console.error('[BusinessHours] Error checking if within hours:', error);
    return true; // Default to open on error
  }
}
