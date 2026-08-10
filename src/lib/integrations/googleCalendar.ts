// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface GoogleCalendarConfig {
  calendar_id: string;
  access_token: string;
  refresh_token: string;
  sync_enabled: boolean;
  conflict_resolution: 'block' | 'override' | 'notify';
  sync_direction: 'bidirectional' | 'to_google' | 'from_google';
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start_time: Date;
  end_time: Date;
  location?: string;
  attendees?: string[];
  booking_id?: string;
  staff_id?: string;
  tenant_id: string;
  google_event_id?: string;
  last_synced?: Date;
}

export interface SyncResult {
  success: boolean;
  events_synced: number;
  conflicts_detected: number;
  errors: string[];
  sync_timestamp: Date;
}

export interface GoogleCalendarBooking {
  id: string;
  tenant_id: string;
  staff_id?: string | null;
  service_name?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  start_at: string | Date;
  end_at: string | Date;
  timezone?: string | null;
  location?: string | null;
  notes?: string | null;
  google_event_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CalendarConflict {
  google_event: calendar_v3.Schema$Event;
  local_booking: GoogleCalendarBooking;
  conflict_type: 'time_overlap';
}

export class GoogleCalendarIntegration {
  private oauth2Client: OAuth2Client;
  private calendar: calendar_v3.Calendar;
  private supabase;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    
    this.supabase = createServerSupabaseClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Initialize OAuth2 credentials for a tenant
   */
  async initializeCredentials(config: GoogleCalendarConfig): Promise<void> {
    this.oauth2Client.setCredentials({
      access_token: config.access_token,
      refresh_token: config.refresh_token
    });

    // Test the connection
    try {
      await this.calendar.calendarList.list();
    } catch (error) {
      // Try to refresh the token
      await this.refreshAccessToken(config);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(config: GoogleCalendarConfig): Promise<string> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      const newAccessToken = credentials.access_token!;

      // Update the stored tokens in database
      await this.updateStoredTokens(config.calendar_id, newAccessToken, credentials.refresh_token);
      
      return newAccessToken;
    } catch (error) {
      defaultLogger.error('Failed to refresh Google Calendar token:', error);
      throw new Error('Calendar authentication expired. Please reconnect your Google Calendar.');
    }
  }

  /**
   * Synchronize booking with Google Calendar
   */
  async syncBookingToGoogle(
    booking: GoogleCalendarBooking,
    config: GoogleCalendarConfig
  ): Promise<{ success: boolean; google_event_id?: string; error?: string }> {
    try {
      await this.initializeCredentials(config);

      const event: calendar_v3.Schema$Event = {
        summary: `${booking.service_name} - ${booking.customer_name}`,
        description: this.buildEventDescription(booking),
        start: {
          dateTime: new Date(booking.start_at).toISOString(),
          timeZone: booking.timezone || 'UTC'
        },
        end: {
          dateTime: new Date(booking.end_at).toISOString(),
          timeZone: booking.timezone || 'UTC'
        },
        location: booking.location,
        attendees: booking.customer_email ? [{ email: booking.customer_email }] : undefined,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
            { method: 'email', minutes: 60 }
          ]
        },
        extendedProperties: {
          private: {
            booking_id: booking.id,
            tenant_id: booking.tenant_id,
            staff_id: booking.staff_id,
            booka_managed: 'true'
          }
        }
      };

      let googleEvent;
      
      if (booking.google_event_id) {
        // Update existing event
        googleEvent = await this.calendar.events.update({
          calendarId: config.calendar_id,
          eventId: booking.google_event_id,
          requestBody: event
        });
      } else {
        // Create new event
        googleEvent = await this.calendar.events.insert({
          calendarId: config.calendar_id,
          requestBody: event
        });
      }

      // Update booking with Google event ID. reservations has no
      // google_event_id/last_synced columns — store them in metadata (merged)
      // and set the real calendar_sent flag.
      await this.supabase
        .from('reservations')
        .update({
          calendar_sent: true,
          metadata: {
            ...(booking.metadata && typeof booking.metadata === 'object' ? booking.metadata : {}),
            google_event_id: googleEvent.data.id,
            google_last_synced: new Date().toISOString(),
          },
        })
        .eq('id', booking.id);

      return {
        success: true,
        google_event_id: googleEvent.data.id!
      };

    } catch (error) {
      defaultLogger.error('Failed to sync booking to Google Calendar:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Sync events from Google Calendar to local database
   */
  async syncFromGoogle(
    tenantId: string,
    staffId: string,
    config: GoogleCalendarConfig,
    timeMin: Date,
    timeMax: Date
  ): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      events_synced: 0,
      conflicts_detected: 0,
      errors: [],
      sync_timestamp: new Date()
    };

    try {
      await this.initializeCredentials(config);

      // Get events from Google Calendar
      const response = await this.calendar.events.list({
        calendarId: config.calendar_id,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const googleEvents = response.data.items || [];

      for (const googleEvent of googleEvents) {
        try {
          // Skip events we created
          if (googleEvent.extendedProperties?.private?.booka_managed === 'true') {
            continue;
          }

          await this.processGoogleEvent(googleEvent, tenantId, staffId, config);
          result.events_synced++;

        } catch (error) {
          result.errors.push(
            `Failed to process event ${googleEvent.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Calendar sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Delete booking from Google Calendar
   */
  async deleteFromGoogle(
    googleEventId: string,
    config: GoogleCalendarConfig
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.initializeCredentials(config);

      await this.calendar.events.delete({
        calendarId: config.calendar_id,
        eventId: googleEventId
      });

      return { success: true };

    } catch (error) {
      defaultLogger.error('Failed to delete event from Google Calendar:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check for conflicts between Google Calendar and local bookings
   */
  async detectConflicts(
    tenantId: string,
    staffId: string,
    config: GoogleCalendarConfig,
    timeRange: { start: Date; end: Date }
  ): Promise<CalendarConflict[]> {
    const conflicts: CalendarConflict[] = [];

    try {
      await this.initializeCredentials(config);

      // Get Google Calendar events
      const googleResponse = await this.calendar.events.list({
        calendarId: config.calendar_id,
        timeMin: timeRange.start.toISOString(),
        timeMax: timeRange.end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const googleEvents = googleResponse.data.items || [];

      // Get local bookings
      const { data: localBookings } = await this.supabase
        .from('reservations')
        .select('*')
        .eq('staff_id', staffId)
        .eq('tenant_id', tenantId)
        .gte('start_at', timeRange.start.toISOString())
        .lte('start_at', timeRange.end.toISOString())
        .eq('status', 'confirmed');

      // Check for conflicts
      for (const googleEvent of googleEvents) {
        if (!googleEvent.start?.dateTime || !googleEvent.end?.dateTime) continue;

        const googleStart = new Date(googleEvent.start.dateTime);
        const googleEnd = new Date(googleEvent.end.dateTime);

        for (const localBooking of (localBookings ?? []) as GoogleCalendarBooking[]) {
          const localStart = new Date(localBooking.start_at);
          const localEnd = new Date(localBooking.end_at);

          // Check for overlap
          if (this.isTimeOverlap(googleStart, googleEnd, localStart, localEnd)) {
            conflicts.push({
              google_event: googleEvent,
              local_booking: localBooking,
              conflict_type: 'time_overlap'
            });
          }
        }
      }

    } catch (error) {
      defaultLogger.error('Failed to detect conflicts:', error);
    }

    return conflicts;
  }

  /**
   * Get available time slots considering Google Calendar
   */
  async getAvailableSlots(
    tenantId: string,
    staffId: string,
    config: GoogleCalendarConfig,
    date: Date,
    duration: number
  ): Promise<Array<{ start: Date; end: Date }>> {
    const availableSlots: Array<{ start: Date; end: Date }> = [];

    try {
      await this.initializeCredentials(config);

      // Get staff schedule for the day
      const { data: schedule } = await this.supabase
        .from('staff_schedules')
        .select('*')
        .eq('staff_id', staffId)
        .eq('day_of_week', date.getDay());

      if (!schedule || schedule.length === 0) {
        return availableSlots;
      }

      const dayStart = new Date(date);
      dayStart.setHours(parseInt(schedule[0].start_time.split(':')[0]));
      dayStart.setMinutes(parseInt(schedule[0].start_time.split(':')[1]));

      const dayEnd = new Date(date);
      dayEnd.setHours(parseInt(schedule[0].end_time.split(':')[0]));
      dayEnd.setMinutes(parseInt(schedule[0].end_time.split(':')[1]));

      // Get all busy periods from Google Calendar
      const googleResponse = await this.calendar.events.list({
        calendarId: config.calendar_id,
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const busyPeriods: Array<{ start: Date; end: Date }> = [];

      // Add Google Calendar events
      for (const event of googleResponse.data.items || []) {
        if (event.start?.dateTime && event.end?.dateTime) {
          busyPeriods.push({
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime)
          });
        }
      }

      // Add existing local bookings
      const { data: localBookings } = await this.supabase
        .from('reservations')
        .select('start_at, end_at')
        .eq('staff_id', staffId)
        .eq('tenant_id', tenantId)
        .gte('start_at', dayStart.toISOString())
        .lte('start_at', dayEnd.toISOString())
        .eq('status', 'confirmed');

      for (const booking of localBookings || []) {
        busyPeriods.push({
          start: new Date(booking.start_at),
          end: new Date(booking.end_at)
        });
      }

      // Sort busy periods and merge overlapping intervals to avoid false gaps
      busyPeriods.sort((a, b) => a.start.getTime() - b.start.getTime());
      const mergedBusy: Array<{ start: Date; end: Date }> = [];
      for (const period of busyPeriods) {
        const last = mergedBusy[mergedBusy.length - 1];
        if (last && period.start <= last.end) {
          // Extend the last interval if this one overlaps
          last.end = new Date(Math.max(last.end.getTime(), period.end.getTime()));
        } else {
          mergedBusy.push({ start: new Date(period.start), end: new Date(period.end) });
        }
      }

      // Find available slots
      let currentTime = dayStart;

      for (const busyPeriod of mergedBusy) {
        if (currentTime < busyPeriod.start) {
          const slotDuration = busyPeriod.start.getTime() - currentTime.getTime();
          if (slotDuration >= duration * 60 * 1000) { // duration in minutes
            availableSlots.push({
              start: new Date(currentTime),
              end: new Date(busyPeriod.start)
            });
          }
        }
        currentTime = new Date(Math.max(currentTime.getTime(), busyPeriod.end.getTime()));
      }

      // Check final slot until end of day
      if (currentTime < dayEnd) {
        const finalSlotDuration = dayEnd.getTime() - currentTime.getTime();
        if (finalSlotDuration >= duration * 60 * 1000) {
          availableSlots.push({
            start: new Date(currentTime),
            end: new Date(dayEnd)
          });
        }
      }

    } catch (error) {
      defaultLogger.error('Failed to get available slots:', error);
    }

    return availableSlots;
  }

  private buildEventDescription(booking: GoogleCalendarBooking): string {
    let description = `Service: ${booking.service_name}\n`;
    description += `Customer: ${booking.customer_name}\n`;
    if (booking.customer_email) description += `Email: ${booking.customer_email}\n`;
    if (booking.customer_phone) description += `Phone: ${booking.customer_phone}\n`;
    if (booking.notes) description += `\nNotes: ${booking.notes}\n`;
    description += `\nManaged by BOOKA`;
    return description;
  }

  private async processGoogleEvent(
    googleEvent: calendar_v3.Schema$Event,
    tenantId: string,
    staffId: string,
    config: GoogleCalendarConfig
  ): Promise<void> {
    if (!googleEvent.start?.dateTime || !googleEvent.end?.dateTime) {
      return; // Skip all-day events
    }

    const startTime = new Date(googleEvent.start.dateTime);
    const endTime = new Date(googleEvent.end.dateTime);

    // Check if we already have this event
    const { data: existingEvent } = await this.supabase
      .from('calendar_blocks')
      .select('*')
      .eq('google_event_id', googleEvent.id)
      .single();

    if (existingEvent) {
      // Update existing event
      await this.supabase
        .from('calendar_blocks')
        .update({
          title: googleEvent.summary || 'Busy',
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          description: googleEvent.description,
          last_synced: new Date().toISOString()
        })
        .eq('google_event_id', googleEvent.id);
    } else {
      // Create new calendar block
      await this.supabase
        .from('calendar_blocks')
        .insert({
          tenant_id: tenantId,
          staff_id: staffId,
          title: googleEvent.summary || 'Busy',
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          description: googleEvent.description,
          google_event_id: googleEvent.id,
          block_type: 'external_calendar',
          last_synced: new Date().toISOString()
        });
    }
  }

  private isTimeOverlap(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date
  ): boolean {
    return start1 < end2 && end1 > start2;
  }

  private async updateStoredTokens(
    calendarId: string,
    accessToken: string,
    refreshToken?: string | null
  ): Promise<void> {
    const updateData: Record<string, string> = {
      access_token: accessToken,
      last_updated: new Date().toISOString()
    };

    if (refreshToken) {
      updateData.refresh_token = refreshToken;
    }

    await this.supabase
      .from('calendar_integrations')
      .update(updateData)
      .eq('calendar_id', calendarId);
  }
}

export default GoogleCalendarIntegration;
