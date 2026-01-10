/**
 * SMS Service - Twilio Integration
 * 
 * Handles sending SMS messages via Twilio
 * Includes pre-built templates for common use cases
 */

import twilio from 'twilio';

interface SMSOptions {
  to: string;
  body: string;
}

/**
 * Initialize Twilio client
 */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Send SMS message
 */
export async function sendSMS(options: SMSOptions): Promise<any> {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
      console.warn('⚠️ Twilio credentials not configured');
      return { success: false, error: 'Twilio not configured' };
    }

    const message = await twilioClient.messages.create({
      body: options.body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: options.to,
    });

    console.log(`✅ SMS sent to ${options.to}: ${message.sid}`);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error('❌ Error sending SMS:', error);
    throw error;
  }
}

/**
 * Send booking confirmation SMS
 */
export async function sendBookingConfirmationSMS(
  phoneNumber: string,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
    confirmationCode?: string;
  }
) {
  const body = `Booking Confirmed! ${bookingDetails.serviceName} on ${bookingDetails.date} at ${bookingDetails.time}. ${
    bookingDetails.confirmationCode ? `Confirmation: ${bookingDetails.confirmationCode}` : ''
  }`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send booking reminder SMS
 */
export async function sendBookingReminderSMS(
  phoneNumber: string,
  bookingDetails: {
    serviceName: string;
    time: string;
    hoursUntil: number;
  }
) {
  const body = `Reminder: Your ${bookingDetails.serviceName} booking is in ${bookingDetails.hoursUntil} hours at ${bookingDetails.time}. See you soon!`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send cancellation SMS
 */
export async function sendCancellationSMS(
  phoneNumber: string,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
  }
) {
  const body = `Your booking for ${bookingDetails.serviceName} on ${bookingDetails.date} at ${bookingDetails.time} has been cancelled.`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send rescheduling SMS
 */
export async function sendReschedulingSMS(
  phoneNumber: string,
  bookingDetails: {
    serviceName: string;
    oldDate: string;
    oldTime: string;
    newDate: string;
    newTime: string;
  }
) {
  const body = `Your ${bookingDetails.serviceName} booking has been rescheduled from ${bookingDetails.oldDate} ${bookingDetails.oldTime} to ${bookingDetails.newDate} ${bookingDetails.newTime}.`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send OTP (One-Time Password) SMS
 */
export async function sendOTPSMS(phoneNumber: string, otp: string) {
  const body = `Your Boka verification code is: ${otp}. Valid for 10 minutes.`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send payment confirmation SMS
 */
export async function sendPaymentConfirmationSMS(
  phoneNumber: string,
  paymentDetails: {
    amount: number;
    method: string;
    transactionId: string;
    serviceName?: string;
  }
) {
  const body = `Payment confirmed: ${paymentDetails.method} - $${paymentDetails.amount.toFixed(2)} (Ref: ${paymentDetails.transactionId}) ${
    paymentDetails.serviceName ? `for ${paymentDetails.serviceName}` : ''
  }`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send appointment rescheduling request SMS
 */
export async function sendRescheduleRequestSMS(
  phoneNumber: string,
  bookingDetails: {
    serviceName: string;
    currentTime: string;
  },
  reschedulingLink: string
) {
  const body = `Your ${bookingDetails.serviceName} is scheduled for ${bookingDetails.currentTime}. Need to reschedule? ${reschedulingLink}`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send staff notification SMS
 */
export async function sendStaffNotificationSMS(
  phoneNumber: string,
  notificationDetails: {
    customerName: string;
    serviceName: string;
    date: string;
    time: string;
  }
) {
  const body = `New booking: ${notificationDetails.customerName} for ${notificationDetails.serviceName} on ${notificationDetails.date} at ${notificationDetails.time}.`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send survey/feedback SMS
 */
export async function sendFeedbackSMS(phoneNumber: string, feedbackLink: string) {
  const body = `Thank you for your booking! We'd love your feedback: ${feedbackLink}`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Send promotional/marketing SMS
 */
export async function sendPromoSMS(
  phoneNumber: string,
  promoDetails: {
    offerName: string;
    discountPercentage: number;
    expiryDate: string;
    code?: string;
  }
) {
  const body = `Special offer: ${promoDetails.discountPercentage}% off ${promoDetails.offerName}! Valid until ${promoDetails.expiryDate}. ${
    promoDetails.code ? `Code: ${promoDetails.code}` : ''
  }`;

  return sendSMS({
    to: phoneNumber,
    body,
  });
}

/**
 * Get Twilio account balance (for monitoring)
 */
export async function getTwilioBalance(): Promise<number | null> {
  try {
    const balance = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID || '').fetch();
    return (balance as any).balance ? parseFloat((balance as any).balance) : null;
  } catch (error) {
    console.error('❌ Error getting Twilio balance:', error);
    return null;
  }
}
