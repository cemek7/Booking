/**
 * WhatsApp Service - Evolution API Integration
 * 
 * Handles sending WhatsApp messages via Evolution API
 * Includes pre-built templates for common use cases
 */

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

/**
 * Send WhatsApp message via Evolution API
 */
export async function sendWhatsApp(message: WhatsAppMessage): Promise<EvolutionResponse> {
  try {
    if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
      console.warn('⚠️ Evolution API credentials not configured');
      return { success: false, error: 'Evolution API not configured' };
    }

    const instanceKey = process.env.EVOLUTION_INSTANCE_KEY;
    const endpoint = `${process.env.EVOLUTION_API_URL}/message/sendText/${instanceKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: message.number,
        text: message.text,
      }),
    });

    const data = (await response.json()) as any;

    if (response.ok && data.key) {
      console.log(`✅ WhatsApp message sent to ${message.number}: ${data.key}`);
      return { success: true, key: data.key };
    }

    return { success: false, error: data.message || 'Failed to send message' };
  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error);
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
    if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
      console.warn('⚠️ Evolution API credentials not configured');
      return { success: false, error: 'Evolution API not configured' };
    }

    const instanceKey = process.env.EVOLUTION_INSTANCE_KEY;
    const endpoint = `${process.env.EVOLUTION_API_URL}/message/sendTemplate/${instanceKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number,
        template: {
          name: templateName,
          language: 'en_US',
          parameters: parameters || [],
        },
      }),
    });

    const data = (await response.json()) as any;

    if (response.ok && data.key) {
      console.log(`✅ WhatsApp template sent to ${number}: ${data.key}`);
      return { success: true, key: data.key };
    }

    return { success: false, error: data.message || 'Failed to send template' };
  } catch (error) {
    console.error('❌ Error sending WhatsApp template:', error);
    throw error;
  }
}

/**
 * Send booking confirmation on WhatsApp
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
  }
) {
  const message = `Hi ${customerName},\n\n✅ Your booking has been confirmed!\n\n📋 Booking Details:\n• Service: ${bookingDetails.serviceName}\n• Date: ${bookingDetails.date}\n• Time: ${bookingDetails.time}${
    bookingDetails.location ? `\n• Location: ${bookingDetails.location}` : ''
  }${bookingDetails.notes ? `\n• Notes: ${bookingDetails.notes}` : ''}\n\nIf you need to cancel or reschedule, please let us know at least 24 hours in advance.\n\nSee you soon! 👋`;

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

/**
 * Get Evolution API instance status
 */
export async function getEvolutionInstanceStatus(): Promise<any> {
  try {
    if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
      console.warn('⚠️ Evolution API credentials not configured');
      return null;
    }

    const instanceKey = process.env.EVOLUTION_INSTANCE_KEY;
    const endpoint = `${process.env.EVOLUTION_API_URL}/instance/info/${instanceKey}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': process.env.EVOLUTION_API_KEY,
      },
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Error getting instance status:', error);
    return null;
  }
}
