import { EvolutionClient } from './evolutionClient';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAppConfig } from './configManager';

export interface BookingNotificationData {
  bookingId: string;
  tenantId: string;
  customerId?: string;
  customerPhone: string;
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
  private evolutionClient: EvolutionClient;
  private supabase: ReturnType<typeof createServerSupabaseClient>;
  private isEnabled: boolean;

  constructor() {
    const config = getAppConfig();
    this.isEnabled = config.integrations.evolution.enabled;
    
    if (this.isEnabled) {
      this.evolutionClient = EvolutionClient.getInstance();
    }
    
    this.supabase = createServerSupabaseClient();
  }

  /**
   * Send booking confirmation notification
   */
  public async sendBookingConfirmation(booking: BookingNotificationData): Promise<{ success: boolean; error?: string }> {
    if (!this.isEnabled) {
      return { success: false, error: 'WhatsApp integration not enabled' };
    }

    try {
      const result = await this.evolutionClient.sendBookingConfirmation(
        booking.tenantId,
        booking.customerPhone,
        {
          bookingId: booking.bookingId,
          tenantId: booking.tenantId,
          customerId: booking.customerId,
          serviceType: booking.serviceName,
          status: booking.status
        }
      );

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'confirmation',
        recipient: booking.customerPhone,
        status: result.success ? 'sent' : 'failed',
        error: result.success ? undefined : String(result.response)
      });

      return { success: result.success };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'confirmation',
        recipient: booking.customerPhone,
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
    if (!this.isEnabled) {
      return { success: false, error: 'WhatsApp integration not enabled' };
    }

    try {
      const result = await this.evolutionClient.sendBookingReminder(
        booking.tenantId,
        booking.customerPhone,
        {
          bookingId: booking.bookingId,
          tenantId: booking.tenantId,
          customerId: booking.customerId,
          serviceType: booking.serviceName,
          status: booking.status
        },
        minutesBefore
      );

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'reminder',
        recipient: booking.customerPhone,
        status: result.success ? 'sent' : 'failed',
        error: result.success ? undefined : String(result.response),
        metadata: { minutesBefore }
      });

      return { success: result.success };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'reminder',
        recipient: booking.customerPhone,
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
    if (!this.isEnabled) {
      return { success: false, error: 'WhatsApp integration not enabled' };
    }

    try {
      const result = await this.evolutionClient.sendBookingStatusUpdate(
        booking.tenantId,
        booking.customerPhone,
        {
          bookingId: booking.bookingId,
          tenantId: booking.tenantId,
          customerId: booking.customerId,
          serviceType: booking.serviceName,
          status: booking.status
        }
      );

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: 'status_update',
        recipient: booking.customerPhone,
        status: result.success ? 'sent' : 'failed',
        error: result.success ? undefined : String(result.response),
        metadata: { previousStatus, newStatus: booking.status }
      });

      return { success: result.success };
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
    if (!this.isEnabled) {
      return { success: false, error: 'WhatsApp integration not enabled' };
    }

    try {
      const result = await this.evolutionClient.sendMessage(
        booking.tenantId,
        booking.customerPhone,
        message
      );

      await this.logNotification({
        bookingId: booking.bookingId,
        tenantId: booking.tenantId,
        type: notificationType,
        recipient: booking.customerPhone,
        status: result.success ? 'sent' : 'failed',
        error: result.success ? undefined : String(result.response),
        message: message
      });

      return { success: result.success };
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
      console.error('Error scheduling notification:', error);
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
        channel: 'whatsapp',
        recipient: notification.recipient,
        status: notification.status,
        message: notification.message,
        error_message: notification.error,
        metadata: notification.metadata,
        sent_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to log notification:', error);
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