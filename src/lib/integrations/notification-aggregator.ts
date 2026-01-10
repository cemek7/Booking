/**
 * Notification Aggregator
 * 
 * Centralizes notification logic for booking events
 * Sends across multiple channels (Email, SMS, WhatsApp)
 * Handles fallbacks and retry logic
 */

import { sendEmail } from './email-service';
import { sendSMS } from './sms-service';
import { sendWhatsApp } from './whatsapp-service';

export type NotificationChannel = 'email' | 'sms' | 'whatsapp';
export type BookingEventType = 'confirmation' | 'reminder' | 'cancellation' | 'reschedule';

interface NotificationRecipient {
  email?: string;
  phone?: string;
  whatsapp?: string;
  preferences?: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
  };
}

interface BookingNotificationData {
  eventType: BookingEventType;
  customer: NotificationRecipient & { name: string };
  staff?: NotificationRecipient & { name: string };
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
    location?: string;
    notes?: string;
  };
  reminderHours?: number;
  oldBooking?: {
    date: string;
    time: string;
  };
}

interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
  timestamp: Date;
}

/**
 * Send booking notifications across preferred channels
 */
export async function notifyBookingEvent(data: BookingNotificationData): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  const preferences = data.customer.preferences || { email: true, sms: false, whatsapp: false };

  console.log(`📢 Sending ${data.eventType} notifications for ${data.customer.name}`);

  // Email notification
  if (preferences.email && data.customer.email) {
    try {
      await sendBookingNotificationEmail(data);
      results.push({
        channel: 'email',
        success: true,
        timestamp: new Date(),
      });
    } catch (error) {
      results.push({
        channel: 'email',
        success: false,
        error: String(error),
        timestamp: new Date(),
      });
    }
  }

  // SMS notification
  if (preferences.sms && data.customer.phone) {
    try {
      await sendBookingNotificationSMS(data);
      results.push({
        channel: 'sms',
        success: true,
        timestamp: new Date(),
      });
    } catch (error) {
      results.push({
        channel: 'sms',
        success: false,
        error: String(error),
        timestamp: new Date(),
      });
    }
  }

  // WhatsApp notification
  if (preferences.whatsapp && data.customer.whatsapp) {
    try {
      await sendBookingNotificationWhatsApp(data);
      results.push({
        channel: 'whatsapp',
        success: true,
        timestamp: new Date(),
      });
    } catch (error) {
      results.push({
        channel: 'whatsapp',
        success: false,
        error: String(error),
        timestamp: new Date(),
      });
    }
  }

  return results;
}

/**
 * Send staff notification across preferred channels
 */
export async function notifyStaffAssignment(data: {
  staff: NotificationRecipient & { name: string };
  customer: { name: string };
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
    notes?: string;
  };
}): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  const preferences = data.staff.preferences || { email: true, sms: false, whatsapp: false };

  console.log(`📢 Notifying staff: ${data.staff.name} of new booking`);

  // Email notification
  if (preferences.email && data.staff.email) {
    try {
      const { sendStaffAssignmentEmail } = await import('./email-service');
      await sendStaffAssignmentEmail(data.staff.email, data.staff.name, {
        customerName: data.customer.name,
        ...data.bookingDetails,
      });
      results.push({
        channel: 'email',
        success: true,
        timestamp: new Date(),
      });
    } catch (error) {
      results.push({
        channel: 'email',
        success: false,
        error: String(error),
        timestamp: new Date(),
      });
    }
  }

  // SMS notification
  if (preferences.sms && data.staff.phone) {
    try {
      const { sendStaffNotificationSMS } = await import('./sms-service');
      await sendStaffNotificationSMS(data.staff.phone, {
        customerName: data.customer.name,
        ...data.bookingDetails,
      });
      results.push({
        channel: 'sms',
        success: true,
        timestamp: new Date(),
      });
    } catch (error) {
      results.push({
        channel: 'sms',
        success: false,
        error: String(error),
        timestamp: new Date(),
      });
    }
  }

  // WhatsApp notification
  if (preferences.whatsapp && data.staff.whatsapp) {
    try {
      const { sendStaffNotificationWhatsApp } = await import('./whatsapp-service');
      await sendStaffNotificationWhatsApp(data.staff.whatsapp, data.staff.name, {
        customerName: data.customer.name,
        ...data.bookingDetails,
      });
      results.push({
        channel: 'whatsapp',
        success: true,
        timestamp: new Date(),
      });
    } catch (error) {
      results.push({
        channel: 'whatsapp',
        success: false,
        error: String(error),
        timestamp: new Date(),
      });
    }
  }

  return results;
}

/**
 * Internal helper: Send email notification based on event type
 */
async function sendBookingNotificationEmail(data: BookingNotificationData) {
  const { sendBookingConfirmation, sendBookingReminder, sendCancellationEmail } = await import(
    './email-service'
  );

  switch (data.eventType) {
    case 'confirmation':
      return sendBookingConfirmation(data.customer.email!, data.customer.name, data.bookingDetails);
    case 'reminder':
      return sendBookingReminder(
        data.customer.email!,
        data.customer.name,
        data.reminderHours || 24,
        data.bookingDetails
      );
    case 'cancellation':
      return sendCancellationEmail(data.customer.email!, data.customer.name, data.bookingDetails);
    case 'reschedule':
      // TODO: Implement reschedule email template
      return null;
  }
}

/**
 * Internal helper: Send SMS notification based on event type
 */
async function sendBookingNotificationSMS(data: BookingNotificationData) {
  const {
    sendBookingConfirmationSMS,
    sendBookingReminderSMS,
    sendCancellationSMS,
    sendReschedulingSMS,
  } = await import('./sms-service');

  switch (data.eventType) {
    case 'confirmation':
      return sendBookingConfirmationSMS(data.customer.phone!, data.bookingDetails);
    case 'reminder':
      return sendBookingReminderSMS(data.customer.phone!, {
        serviceName: data.bookingDetails.serviceName,
        time: data.bookingDetails.time,
        hoursUntil: data.reminderHours || 24,
      });
    case 'cancellation':
      return sendCancellationSMS(data.customer.phone!, data.bookingDetails);
    case 'reschedule':
      return sendReschedulingSMS(data.customer.phone!, {
        serviceName: data.bookingDetails.serviceName,
        oldDate: data.oldBooking?.date || '',
        oldTime: data.oldBooking?.time || '',
        newDate: data.bookingDetails.date,
        newTime: data.bookingDetails.time,
      });
  }
}

/**
 * Internal helper: Send WhatsApp notification based on event type
 */
async function sendBookingNotificationWhatsApp(data: BookingNotificationData) {
  const {
    sendBookingConfirmationWhatsApp,
    sendBookingReminderWhatsApp,
    sendCancellationWhatsApp,
    sendRescheduleWhatsApp,
  } = await import('./whatsapp-service');

  switch (data.eventType) {
    case 'confirmation':
      return sendBookingConfirmationWhatsApp(data.customer.whatsapp!, data.customer.name, data.bookingDetails);
    case 'reminder':
      return sendBookingReminderWhatsApp(data.customer.whatsapp!, data.customer.name, {
        ...data.bookingDetails,
        hoursUntil: data.reminderHours || 24,
      });
    case 'cancellation':
      return sendCancellationWhatsApp(data.customer.whatsapp!, data.customer.name, data.bookingDetails);
    case 'reschedule':
      return sendRescheduleWhatsApp(data.customer.whatsapp!, data.customer.name, {
        serviceName: data.bookingDetails.serviceName,
        oldDate: data.oldBooking?.date || '',
        oldTime: data.oldBooking?.time || '',
        newDate: data.bookingDetails.date,
        newTime: data.bookingDetails.time,
      });
  }
}

/**
 * Send batch notifications with retry logic
 */
export async function sendBatchNotifications(
  recipients: Array<{ data: BookingNotificationData; retries?: number }>
): Promise<Map<string, NotificationResult[]>> {
  const results = new Map<string, NotificationResult[]>();
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  for (const item of recipients) {
    let lastError;
    const retries = item.retries || MAX_RETRIES;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const notificationResults = await notifyBookingEvent(item.data);
        results.set(item.data.customer.email || item.data.customer.phone!, notificationResults);
        break;
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) {
          console.warn(`⚠️ Retry ${attempt + 1}/${retries} for ${item.data.customer.name}`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }

    if (lastError && !results.has(item.data.customer.email || item.data.customer.phone!)) {
      results.set(item.data.customer.email || item.data.customer.phone!, [
        {
          channel: 'email',
          success: false,
          error: String(lastError),
          timestamp: new Date(),
        },
      ]);
    }
  }

  return results;
}

/**
 * Get notification delivery status
 */
export function summarizeNotificationResults(results: NotificationResult[]): {
  total: number;
  successful: number;
  failed: number;
  successRate: string;
} {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const successRate = results.length > 0 ? ((successful / results.length) * 100).toFixed(2) : '0';

  return {
    total: results.length,
    successful,
    failed,
    successRate: `${successRate}%`,
  };
}
