import { defaultLogger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendBookingConfirmation, sendBookingReminder } from '@/lib/integrations/email-service';

export interface BookingNotificationData {
  bookingId: string;
  tenantId: string;
  customerId?: string;
  customerPhone: string;
  customerEmail?: string;
  customerName?: string;
  serviceName: string;
  bookingDate: string;
  bookingTime: string;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
}

export interface NotificationTemplate {
  type: string;
  message: string;
  requiresInteraction?: boolean;
}

export class BookingNotificationService {
  private supabase: ReturnType<typeof createServerSupabaseClient>;

  constructor() {
    this.supabase = createServerSupabaseClient();
  }

  /**
   * Send booking confirmation notification
   */
  public async sendBookingConfirmation(booking: BookingNotificationData): Promise<{ success: boolean; error?: string }> {
    try {
      const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
      const client = await getTenantWhatsAppProviderClient(booking.tenantId);
      if (!client) return { success: false, error: 'No WhatsApp config for tenant' };

      const message =
        `✅ *Booking Confirmed*\n\n` +
        `Hi ${booking.customerName || 'there'}! Your booking has been confirmed.\n\n` +
        `📋 Service: ${booking.serviceName}\n` +
        `📅 Date: ${booking.bookingDate}\n` +
        `⏰ Time: ${booking.bookingTime}\n` +
        `🔖 Ref: #${booking.bookingId.slice(-8)}\n\n` +
        `_Reply to this message if you need to make any changes._`;

      await client.sendTextMessage(booking.customerPhone, message);

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'confirmation',
        recipient: booking.customerPhone,
        channel: 'whatsapp',
        status: 'sent',
        message,
      });

      // Also send email confirmation if customer has an email address
      if (booking.customerEmail) {
        try {
          await sendBookingConfirmation(
            booking.customerEmail,
            booking.customerName || 'there',
            {
              serviceName: booking.serviceName,
              date: booking.bookingDate,
              time: booking.bookingTime,
            }
          );
          await this.logNotification({
            bookingId: booking.bookingId,
            tenantId: booking.tenantId,
            type: 'confirmation',
            recipient: booking.customerEmail,
            channel: 'email',
            status: 'sent',
          });
        } catch (emailErr) {
          defaultLogger.warn('BookingNotificationService: email confirmation failed', emailErr);
          await this.logNotification({
            bookingId: booking.bookingId,
            tenantId: booking.tenantId,
            type: 'confirmation',
            recipient: booking.customerEmail,
            channel: 'email',
            status: 'failed',
            error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
          });
        }
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'confirmation',
        recipient: booking.customerPhone,
        channel: 'whatsapp',
        status: 'failed',
        error: errorMessage
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send booking reminder notification
   */
  public async sendBookingReminder(
    booking: BookingNotificationData,
    minutesBefore: number = 30
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
      const client = await getTenantWhatsAppProviderClient(booking.tenantId);
      if (!client) return { success: false, error: 'No WhatsApp config for tenant' };

      const timeLabel = minutesBefore >= 60
        ? `${minutesBefore / 60} hour${minutesBefore / 60 !== 1 ? 's' : ''}`
        : `${minutesBefore} minute${minutesBefore !== 1 ? 's' : ''}`;

      const message =
        `⏰ *Booking Reminder*\n\n` +
        `Hi ${booking.customerName || 'there'}! This is a reminder that your appointment is in ${timeLabel}.\n\n` +
        `📋 Service: ${booking.serviceName}\n` +
        `📅 Date: ${booking.bookingDate}\n` +
        `⏰ Time: ${booking.bookingTime}\n\n` +
        `_See you soon!_`;

      await client.sendTextMessage(booking.customerPhone, message);

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'reminder',
        recipient: booking.customerPhone,
        channel: 'whatsapp',
        status: 'sent',
        message,
        metadata: { minutesBefore }
      });

      // Also send email reminder if customer has an email address
      if (booking.customerEmail) {
        const hoursUntil = Math.round(minutesBefore / 60);
        try {
          await sendBookingReminder(
            booking.customerEmail,
            booking.customerName || 'there',
            hoursUntil,
            {
              serviceName: booking.serviceName,
              date: booking.bookingDate,
              time: booking.bookingTime,
            }
          );
          await this.logNotification({
            bookingId: booking.bookingId,
            tenantId: booking.tenantId,
            type: 'reminder',
            recipient: booking.customerEmail,
            channel: 'email',
            status: 'sent',
            metadata: { minutesBefore }
          });
        } catch (emailErr) {
          defaultLogger.warn('BookingNotificationService: email reminder failed', emailErr);
        }
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'reminder',
        recipient: booking.customerPhone,
        channel: 'whatsapp',
        status: 'failed',
        error: errorMessage
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send booking status update notification
   */
  public async sendStatusUpdate(
    booking: BookingNotificationData,
    previousStatus?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
      const client = await getTenantWhatsAppProviderClient(booking.tenantId);
      if (!client) return { success: false, error: 'No WhatsApp config for tenant' };

      const statusEmoji: Record<string, string> = {
        confirmed: '✅', cancelled: '❌', completed: '🎉', requested: '📩', no_show: '⚠️'
      };
      const emoji = statusEmoji[booking.status] ?? '📋';

      const message =
        `${emoji} *Booking Update*\n\n` +
        `Hi ${booking.customerName || 'there'}! Your booking status has been updated.\n\n` +
        `📋 Service: ${booking.serviceName}\n` +
        `📅 Date: ${booking.bookingDate}\n` +
        `⏰ Time: ${booking.bookingTime}\n` +
        `Status: *${booking.status.toUpperCase()}*\n\n` +
        `_Contact us if you have any questions._`;

      await client.sendTextMessage(booking.customerPhone, message);

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'status_update',
        recipient: booking.customerPhone,
        status: 'sent',
        message,
        metadata: { previousStatus, newStatus: booking.status }
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'status_update',
        recipient: booking.customerPhone,
        status: 'failed',
        error: errorMessage
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send custom notification
   */
  public async sendCustomNotification(
    booking: BookingNotificationData,
    message: string,
    notificationType: string = 'custom'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
      const client = await getTenantWhatsAppProviderClient(booking.tenantId);
      if (!client) return { success: false, error: 'No WhatsApp config for tenant' };

      await client.sendTextMessage(booking.customerPhone, message);

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: notificationType,
        recipient: booking.customerPhone,
        status: 'sent',
        message,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: notificationType,
        recipient: booking.customerPhone,
        status: 'failed',
        error: errorMessage
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Schedule reminder notifications
   */
  public async scheduleReminders(booking: BookingNotificationData): Promise<{ success: boolean; error?: string }> {
    try {
      const bookingDateTime = new Date(`${booking.bookingDate} ${booking.bookingTime}`);
      const now = new Date();
      
      // Schedule 24-hour reminder
      const reminder24h = new Date(bookingDateTime.getTime() - 24 * 60 * 60 * 1000);
      if (reminder24h > now) {
        await this.scheduleNotification(booking, reminder24h, 'reminder_24h', 24 * 60);
      }
      
      // Schedule 1-hour reminder
      const reminder1h = new Date(bookingDateTime.getTime() - 60 * 60 * 1000);
      if (reminder1h > now) {
        await this.scheduleNotification(booking, reminder1h, 'reminder_1h', 60);
      }
      
      // Schedule 15-minute reminder
      const reminder15m = new Date(bookingDateTime.getTime() - 15 * 60 * 1000);
      if (reminder15m > now) {
        await this.scheduleNotification(booking, reminder15m, 'reminder_15m', 15);
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Schedule a notification for future delivery
   */
  private async scheduleNotification(
    booking: BookingNotificationData,
    scheduledTime: Date,
    type: string,
    minutesBefore: number
  ): Promise<void> {
    try {
      await this.supabase.from('scheduled_notifications').insert({
        booking_id: booking.bookingId,
        tenant_id: booking.tenantId,
        notification_type: type,
        recipient: booking.customerPhone,
        scheduled_for: scheduledTime.toISOString(),
        metadata: {
          minutesBefore,
          serviceName: booking.serviceName,
          customerName: booking.customerName
        },
        status: 'scheduled'
      });
    } catch (error) {
      defaultLogger.error('Error scheduling notification:', error);
    }
  }

  /**
   * Log notification for audit trail
   */
  private async logNotification(notification: {
    bookingId: string;
    tenantId: string;
    type: string;
    recipient: string;
    channel?: string;
    status: 'sent' | 'failed' | 'scheduled';
    error?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.supabase.from('booking_notifications').insert({
        booking_id: notification.bookingId,
        tenant_id: notification.tenantId,
        notification_type: notification.type,
        channel: notification.channel || 'whatsapp',
        recipient: notification.recipient,
        status: notification.status,
        message: notification.message,
        error_message: notification.error,
        metadata: notification.metadata,
        sent_at: new Date().toISOString()
      });
    } catch (error) {
      defaultLogger.error('Failed to log notification:', error);
    }
  }

  /**
   * Get notification history for a booking
   */
  public async getNotificationHistory(bookingId: string): Promise<{
    success: boolean;
    notifications?: Array<{
      type: string;
      status: string;
      sentAt: string;
      error?: string;
    }>;
    error?: string;
  }> {
    try {
      const { data, error } = await this.supabase
        .from('booking_notifications')
        .select('notification_type, status, sent_at, error_message')
        .eq('booking_id', bookingId)
        .order('sent_at', { ascending: false });

      if (error) {
        return { success: false, error: error.message };
      }

      const notifications = data?.map(n => ({
        type: n.notification_type,
        status: n.status,
        sentAt: n.sent_at,
        error: n.error_message
      })) || [];

      return { success: true, notifications };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Cancel scheduled notifications for a booking
   */
  public async cancelScheduledNotifications(bookingId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('scheduled_notifications')
        .update({ status: 'cancelled' })
        .eq('booking_id', bookingId)
        .eq('status', 'scheduled');

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const bookingNotificationService = new BookingNotificationService();
