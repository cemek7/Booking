/**
 * Email Service - SendGrid Integration
 * 
 * Handles sending transactional emails via SendGrid
 * Includes pre-built templates for common use cases
 */

import { defaultLogger } from '@/lib/logger';
import sgMail from '@sendgrid/mail';
import { generateCalendarLinks, type BookingEvent } from './universalCalendar';

/** Escape HTML entities to prevent injection in email templates */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
}

/**
 * Initialize SendGrid client
 */
const initSendGrid = () => {
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }
};

/**
 * Send email via SendGrid
 */
export async function sendEmail(options: EmailOptions): Promise<any> {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      defaultLogger.warn('⚠️ SENDGRID_API_KEY not configured');
      return { success: false, error: 'SendGrid not configured' };
    }

    initSendGrid();

    const fromEmail = options.from || process.env.SENDGRID_FROM_EMAIL;
    if (!fromEmail) {
      defaultLogger.warn('⚠️ No from address: set SENDGRID_FROM_EMAIL or pass options.from');
      return { success: false, error: 'missing_from_address' };
    }

    const message = {
      to: options.to,
      from: fromEmail,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    };

    // Wrap SendGrid call with a timeout to prevent hanging the booking flow
    const SENDGRID_TIMEOUT_MS = 10_000;
    const response = await Promise.race([
      sgMail.send(message),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SendGrid request timed out')), SENDGRID_TIMEOUT_MS)
      ),
    ]);
    const recipient = Array.isArray(options.to) ? `${options.to.length} recipients` : options.to.replace(/(.{2}).*@/, '$1***@');
    defaultLogger.info(`Email sent: ${options.subject} to ${recipient}`);
    return { success: true, messageId: response[0].headers['x-message-id'] };
  } catch (error) {
    defaultLogger.error('❌ Error sending email:', error);
    throw error;
  }
}

/**
 * Send welcome email
 */
export async function sendWelcomeEmail(email: string, name: string) {
  return sendEmail({
    to: email,
    subject: 'Welcome to Boka!',
    html: `
      <h1>Welcome, ${name}!</h1>
      <p>Thank you for joining Boka. We're excited to help you manage your bookings.</p>
      <p>Get started by:</p>
      <ul>
        <li>Creating your first service</li>
        <li>Adding your staff members</li>
        <li>Setting up your availability</li>
      </ul>
      <p>Questions? Reply to this email or visit our support page.</p>
    `,
  });
}

/**
 * Send booking confirmation email (includes universal calendar links)
 */
export async function sendBookingConfirmation(
  email: string,
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
  let calendarHtml = '';
  if (bookingDetails.calendarEvent) {
    try {
      const links = generateCalendarLinks(bookingDetails.calendarEvent);
      const linkButtons = links.map(l =>
        `<a href="${l.url}" style="display:inline-block;margin:4px 6px 4px 0;padding:8px 14px;background:#4A5568;color:#fff;text-decoration:none;border-radius:4px;font-size:13px;">${l.name}</a>`
      ).join('');
      calendarHtml = `
        <div style="margin-top:20px;">
          <p><strong>Add to your calendar:</strong></p>
          <p>${linkButtons}</p>
        </div>`;
    } catch {
      // calendar links are non-critical; skip on error
    }
  }

  return sendEmail({
    to: email,
    subject: 'Booking Confirmation - Boka',
    html: `
      <h2>Booking Confirmed!</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your booking has been confirmed:</p>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Service:</strong> ${escapeHtml(bookingDetails.serviceName)}</p>
        <p><strong>Date:</strong> ${escapeHtml(bookingDetails.date)}</p>
        <p><strong>Time:</strong> ${escapeHtml(bookingDetails.time)}</p>
        ${bookingDetails.location ? `<p><strong>Location:</strong> ${escapeHtml(bookingDetails.location)}</p>` : ''}
        ${bookingDetails.notes ? `<p><strong>Notes:</strong> ${escapeHtml(bookingDetails.notes)}</p>` : ''}
      </div>
      ${calendarHtml}
      <p>If you need to cancel or reschedule, please let us know at least 24 hours in advance.</p>
      <p>See you soon!</p>
    `,
  });
}

/**
 * Send booking reminder email
 */
export async function sendBookingReminder(
  email: string,
  customerName: string,
  hoursUntilBooking: number,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
  }
) {
  return sendEmail({
    to: email,
    subject: `Reminder: Your booking in ${hoursUntilBooking} hours - Boka`,
    html: `
      <h2>Booking Reminder</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>This is a friendly reminder about your upcoming booking:</p>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Service:</strong> ${escapeHtml(bookingDetails.serviceName)}</p>
        <p><strong>Date:</strong> ${escapeHtml(bookingDetails.date)}</p>
        <p><strong>Time:</strong> ${escapeHtml(bookingDetails.time)}</p>
      </div>

      <p>Please arrive 10 minutes early if possible.</p>
      <p>See you soon!</p>
    `,
  });
}

/**
 * Send cancellation email
 */
export async function sendCancellationEmail(
  email: string,
  customerName: string,
  bookingDetails: {
    serviceName: string;
    date: string;
    time: string;
  }
) {
  return sendEmail({
    to: email,
    subject: 'Booking Cancelled - Boka',
    html: `
      <h2>Booking Cancelled</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your booking has been cancelled:</p>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Service:</strong> ${escapeHtml(bookingDetails.serviceName)}</p>
        <p><strong>Date:</strong> ${escapeHtml(bookingDetails.date)}</p>
        <p><strong>Time:</strong> ${escapeHtml(bookingDetails.time)}</p>
      </div>

      <p>If you'd like to rebook, please visit our website or contact us.</p>
    `,
  });
}

/**
 * Send staff assignment notification
 */
export async function sendStaffAssignmentEmail(
  email: string,
  staffName: string,
  bookingDetails: {
    customerName: string;
    serviceName: string;
    date: string;
    time: string;
    notes?: string;
  }
) {
  return sendEmail({
    to: email,
    subject: `New Booking Assignment - ${escapeHtml(bookingDetails.serviceName)}`,
    html: `
      <h2>You've been assigned a new booking</h2>
      <p>Hi ${escapeHtml(staffName)},</p>
      <p>A new booking has been assigned to you:</p>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Customer:</strong> ${escapeHtml(bookingDetails.customerName)}</p>
        <p><strong>Service:</strong> ${escapeHtml(bookingDetails.serviceName)}</p>
        <p><strong>Date:</strong> ${escapeHtml(bookingDetails.date)}</p>
        <p><strong>Time:</strong> ${escapeHtml(bookingDetails.time)}</p>
        ${bookingDetails.notes ? `<p><strong>Notes:</strong> ${escapeHtml(bookingDetails.notes)}</p>` : ''}
      </div>

      <p>Please confirm your availability in the system.</p>
    `,
  });
}

/**
 * Send invoice/receipt email
 */
export async function sendInvoiceEmail(
  email: string,
  customerName: string,
  invoiceDetails: {
    invoiceNumber: string;
    date: string;
    amount: number;
    items: Array<{ description: string; amount: number }>;
    dueDate?: string;
  }
) {
  const itemsHtml = invoiceDetails.items
    .map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>$${item.amount.toFixed(2)}</td></tr>`)
    .join('');

  return sendEmail({
    to: email,
    subject: `Invoice #${escapeHtml(invoiceDetails.invoiceNumber)} - Boka`,
    html: `
      <h2>Invoice</h2>
      <p>Hi ${escapeHtml(customerName)},</p>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Invoice #:</strong> ${escapeHtml(invoiceDetails.invoiceNumber)}</p>
        <p><strong>Date:</strong> ${escapeHtml(invoiceDetails.date)}</p>
        ${invoiceDetails.dueDate ? `<p><strong>Due Date:</strong> ${escapeHtml(invoiceDetails.dueDate)}</p>` : ''}
      </div>
      
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <th style="text-align: left; padding: 10px;">Description</th>
          <th style="text-align: right; padding: 10px;">Amount</th>
        </tr>
        ${itemsHtml}
        <tr style="font-weight: bold; border-top: 2px solid #ddd;">
          <td style="padding: 10px;">Total</td>
          <td style="text-align: right; padding: 10px;">$${invoiceDetails.amount.toFixed(2)}</td>
        </tr>
      </table>
      
      <p>Thank you for your business!</p>
    `,
  });
}
