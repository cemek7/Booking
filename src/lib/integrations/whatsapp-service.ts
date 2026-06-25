import { defaultLogger } from '@/lib/logger';
import { defaultLogger as logger } from '@/lib/logger';
import { generateCalendarLinks, type BookingEvent } from './universalCalendar';
import { getDefaultWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';

/** Mask a phone number or email for safe logging */
function maskPII(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  // Phone: show last 4 digits
  return value.length > 4 ? `***${value.slice(-4)}` : '****';
}

interface WhatsAppMessage {
  number: string;
  text?: string;
  template?: {
    name: string;
    language?: string;
    parameters?: Array<{ default: string }>;
  };
}

interface EvolutionResponse {
  success: boolean;
  key?: string;
  error?: string;
}

export async function sendWhatsApp(message: WhatsAppMessage): Promise<EvolutionResponse> {
  try {
    const client = getDefaultWhatsAppProviderClient();
    if (!client) {
      logger.warn('WhatsApp provider credentials not configured');
      return { success: false, error: 'WhatsApp provider not configured' };
    }

    if (message.template && client.sendTemplateMessage) {
      const result = await client.sendTemplateMessage(
        message.number,
        message.template.name,
        message.template.parameters
      );
      if (result.success) {
        logger.info(`WhatsApp template sent to ${maskPII(message.number)}${result.messageId ? `: ${result.messageId}` : ''}`);
        return { success: true, key: result.messageId };
      }
      return { success: false, error: 'Failed to send template message' };
    }

    const result = await client.sendTextMessage(message.number, message.text || '');
    if (result.success) {
      logger.info(`WhatsApp message sent to ${maskPII(message.number)}${result.messageId ? `: ${result.messageId}` : ''}`);
      return { success: true, key: result.messageId };
    }

    return { success: false, error: 'Failed to send message' };
  } catch (error) {
    logger.error('Error sending WhatsApp message:', { error });
    throw error;
  }
}

/**
 * Send WhatsApp template message
 */
export async function sendWhatsAppTemplate(
  number: string,
  templateName: string,
  parameters?: Array<{ default: string }>
): Promise<EvolutionResponse> {
  try {
    const client = getDefaultWhatsAppProviderClient();
    if (!client) {
      logger.warn('WhatsApp provider credentials not configured');
      return { success: false, error: 'WhatsApp provider not configured' };
    }

    if (!client.sendTemplateMessage) {
      return { success: false, error: 'Template sending not supported by configured provider' };
    }

    const result = await client.sendTemplateMessage(number, templateName, parameters);
    if (result.success) {
      logger.info(`WhatsApp template sent to ${maskPII(number)}${result.messageId ? `: ${result.messageId}` : ''}`);
      return { success: true, key: result.messageId };
    }

    return { success: false, error: 'Failed to send template' };
  } catch (error) {
    logger.error('Error sending WhatsApp template:', { error });
    throw error;
  }
}

/**
 * Send booking confirmation on WhatsApp (includes universal calendar link)
 */
export async function sendBookingConfirmationWhatsApp(
  phoneNumber: string,
  customerName: string,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
    location?: string;
    notes?: string;
    calendarEvent?: BookingEvent;
  }
) {
  let calendarLine = '';
  if (bookingDetails.calendarEvent) {
    try {
      const links = generateCalendarLinks(bookingDetails.calendarEvent);
      const googleLink = links.find(l => l.name === 'Google Calendar');
      if (googleLink) {
        calendarLine = `\n\n📅 Add to calendar: ${googleLink.url}`;
      }
    } catch {
      // calendar link is non-critical; skip on error
    }
  }

  const message =
    `Hi ${customerName},\n\n✅ Your booking has been confirmed!\n\n📋 Booking Details:\n• Service: ${bookingDetails.serviceName}\n• Date: ${bookingDetails.date}\n• Time: ${bookingDetails.time}` +
    (bookingDetails.location ? `\n• Location: ${bookingDetails.location}` : '') +
    (bookingDetails.notes ? `\n• Notes: ${bookingDetails.notes}` : '') +
    calendarLine +
    `\n\nIf you need to cancel or reschedule, please let us know at least 24 hours in advance.\n\nSee you soon! 👋`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send payment request link on WhatsApp (pre-payment, mid-conversation)
 */
export async function sendPaymentLinkWhatsApp(
  phoneNumber: string,
  customerName: string,
  paymentDetails: {
    paymentUrl: string;
    serviceName: string;
    amount?: number;
    currency?: string;
    expiresInMinutes?: number;
  }
) {
  const amountLine = paymentDetails.amount
    ? `\n💰 Amount: ${paymentDetails.currency || ''} ${paymentDetails.amount.toFixed(2)}`
    : '';
  const expiryLine = paymentDetails.expiresInMinutes
    ? `\n⏳ Link expires in ${paymentDetails.expiresInMinutes} minutes`
    : '';

  const message =
    `Hi ${customerName},\n\n💳 *Complete Your Booking Payment*\n\n` +
    `📋 Service: ${paymentDetails.serviceName}` +
    amountLine +
    expiryLine +
    `\n\n👉 Pay here: ${paymentDetails.paymentUrl}\n\n` +
    `_Reply DONE once payment is complete._`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send booking reminder on WhatsApp
 */
export async function sendBookingReminderWhatsApp(
  phoneNumber: string,
  customerName: string,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
    hoursUntil: number;
  }
) {
  const message = `Hi ${customerName},\n\n🔔 Booking Reminder\n\nYour ${bookingDetails.serviceName} is scheduled in ${bookingDetails.hoursUntil} hours.\n\n⏰ ${bookingDetails.time} on ${bookingDetails.date}\n\nPlease arrive 10 minutes early if possible.\n\nSee you soon! 🙌`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send cancellation notification on WhatsApp
 */
export async function sendCancellationWhatsApp(
  phoneNumber: string,
  customerName: string,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
  }
) {
  const message = `Hi ${customerName},\n\n❌ Booking Cancelled\n\nYour booking for ${bookingDetails.serviceName} on ${bookingDetails.date} at ${bookingDetails.time} has been cancelled.\n\nIf you'd like to rebook, please visit our website or reply to this message.`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send rescheduling notification on WhatsApp
 */
export async function sendRescheduleWhatsApp(
  phoneNumber: string,
  customerName: string,
  bookingDetails: {
    serviceName: string;
    oldDate: string;
    oldTime: string;
    newDate: string;
    newTime: string;
  }
) {
  const message = `Hi ${customerName},\n\n📅 Booking Rescheduled\n\nYour ${bookingDetails.serviceName} has been rescheduled:\n\n❌ Old: ${bookingDetails.oldDate} at ${bookingDetails.oldTime}\n✅ New: ${bookingDetails.newDate} at ${bookingDetails.newTime}\n\nThank you! 👍`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send payment confirmation on WhatsApp
 */
export async function sendPaymentConfirmationWhatsApp(
  phoneNumber: string,
  customerName: string,
  paymentDetails: {
    amount: number;
    method: string;
    transactionId: string;
    serviceName?: string;
  }
) {
  const message = `Hi ${customerName},\n\n💳 Payment Confirmed\n\n✅ Amount: $${paymentDetails.amount.toFixed(2)}\n✅ Method: ${paymentDetails.method}\n✅ Ref: ${paymentDetails.transactionId}${
    paymentDetails.serviceName ? `\n✅ Service: ${paymentDetails.serviceName}` : ''
  }\n\nThank you for your payment! 🙏`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send OTP verification on WhatsApp
 */
export async function sendOTPWhatsApp(phoneNumber: string, otp: string, validityMinutes: number = 10) {
  const message = `Your Boka verification code is: *${otp}*\n\nValid for ${validityMinutes} minutes.\n\nDo not share this code with anyone.`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send staff notification on WhatsApp
 */
export async function sendStaffNotificationWhatsApp(
  phoneNumber: string,
  staffName: string,
  bookingDetails: {
    customerName: string;
    serviceName: string;
    date: string;
    time: string;
    notes?: string;
  }
) {
  const message = `Hi ${staffName},\n\n📌 New Booking Assignment\n\n👤 Customer: ${bookingDetails.customerName}\n📋 Service: ${bookingDetails.serviceName}\n📅 Date: ${bookingDetails.date}\n⏰ Time: ${bookingDetails.time}${
    bookingDetails.notes ? `\n📝 Notes: ${bookingDetails.notes}` : ''
  }\n\nPlease confirm your availability in the system. 📱`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send feedback request on WhatsApp
 */
export async function sendFeedbackWhatsApp(
  phoneNumber: string,
  customerName: string,
  feedbackLink: string
) {
  const message = `Hi ${customerName},\n\n⭐ Thank you for your booking!\n\nWe'd love to hear your feedback:\n\n👉 ${feedbackLink}\n\nYour opinion helps us improve! 🙏`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send promotional offer on WhatsApp
 */
export async function sendPromoWhatsApp(
  phoneNumber: string,
  promoDetails: {
    offerName: string;
    discountPercentage: number;
    expiryDate: string;
    code?: string;
  }
) {
  const message = `🎉 Special Offer!\n\n🔥 ${promoDetails.discountPercentage}% OFF ${promoDetails.offerName.toUpperCase()}\n\n⏰ Valid until: ${promoDetails.expiryDate}${
    promoDetails.code ? `\n\n💳 Code: *${promoDetails.code}*` : ''
  }\n\nDon't miss out! 👉 Book now`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

/**
 * Send invoice/receipt on WhatsApp
 */
export async function sendInvoiceWhatsApp(
  phoneNumber: string,
  customerName: string,
  invoiceDetails: {
    invoiceNumber: string;
    date: string;
    amount: number;
    items: Array<{ description: string; amount: number }>;
  }
) {
  const itemsList = invoiceDetails.items
    .map((item) => `• ${item.description}: $${item.amount.toFixed(2)}`)
    .join('\n');

  const message = `Hi ${customerName},\n\n📄 Invoice #${invoiceDetails.invoiceNumber}\n\n📅 Date: ${invoiceDetails.date}\n\n${itemsList}\n\n💰 Total: $${invoiceDetails.amount.toFixed(2)}\n\nThank you for your business! 🙏`;

  return sendWhatsApp({
    number: phoneNumber,
    text: message,
  });
}

export async function getEvolutionInstanceStatus(): Promise<unknown> {
  try {
    const client = getDefaultWhatsAppProviderClient();
    if (!client) {
      defaultLogger.warn('⚠️ WhatsApp provider credentials not configured');
      return null;
    }
    return client.getConnectionStatus();
  } catch (error) {
    logger.error('Error getting WhatsApp provider status:', { error });
    return null;
  }
}
