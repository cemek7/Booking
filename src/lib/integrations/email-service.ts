/**
 * Email Service - Resend transport
 *
 * Centralized mail sending for Booka. Keeps the public surface stable while
 * allowing sender identities and provider choices to evolve through config.
 */

import { defaultLogger } from '@/lib/logger';
import { generateCalendarLinks, type BookingEvent } from './universalCalendar';
import { makeUnsubscribeToken } from '@/lib/email/unsubscribe';
import { isUnsubscribed } from '@/lib/email/preferences';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { resolveSenderAddress, type EmailSenderKey } from '@/lib/email/senders';

/** Secret for signing unsubscribe tokens (mirrors /api/email/unsubscribe). */
function unsubscribeSecret(): string {
  return (
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.WEBHOOK_SIGNATURE_SECRET ||
    process.env.JWT_SECRET ||
    ''
  );
}

/** Escape HTML entities to prevent injection in email templates */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
  senderKey?: EmailSenderKey;
  /** Marketing (non-transactional) mail — suppressed if the recipient opted out. */
  marketing?: boolean;
  /** Enables a one-click List-Unsubscribe header; also drives marketing suppression. */
  unsubscribe?: { tenantId: string; recipient: string; list: string };
}

type EmailSendResult = {
  success: boolean;
  error?: string;
  messageId?: string;
  suppressed?: boolean;
};

function getResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY || process.env.EMAIL_SERVICE_API_KEY || undefined;
}

function getEmailBaseUrl(): string {
  return process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
}

type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

async function sendViaResend(payload: ResendPayload): Promise<{ id?: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    defaultLogger.warn('⚠️ RESEND_API_KEY not configured');
    return { id: undefined };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Resend API error (${response.status}): ${text || response.statusText}`);
  }

  return (await response.json()) as { id?: string };
}

/**
 * Send email via Resend
 */
export async function sendEmail(options: EmailOptions): Promise<EmailSendResult> {
  try {
    const apiKey = getResendApiKey();
    if (!apiKey) {
      return { success: false, error: 'Resend not configured' };
    }

    const fromEmail = options.from || resolveSenderAddress(options.senderKey || 'default');
    if (!fromEmail) {
      defaultLogger.warn('⚠️ No from address: set EMAIL_DEFAULT_FROM/RESEND_FROM_EMAIL or pass options.from');
      return { success: false, error: 'missing_from_address' };
    }

    // Never send marketing mail to a recipient who has opted out (CAN-SPAM/GDPR).
    if (options.marketing && options.unsubscribe) {
      try {
        const admin = createSupabaseAdminClient();
        if (await isUnsubscribed(admin, options.unsubscribe)) {
          defaultLogger.info(`Email suppressed (unsubscribed): ${options.subject}`);
          return { success: true, suppressed: true };
        }
      } catch (err) {
        defaultLogger.warn('Unsubscribe check failed, proceeding to send', { error: String(err) });
      }
    }

    // One-click List-Unsubscribe header (RFC 8058). The token rides in the query
    // string so the route can verify it on the provider's one-click POST.
    let headers: Record<string, string> | undefined;
    if (options.unsubscribe) {
      const secret = unsubscribeSecret();
      if (secret) {
        const token = makeUnsubscribeToken(options.unsubscribe, secret);
        const base = getEmailBaseUrl();
        const url = `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
        headers = {
          'List-Unsubscribe': `<${url}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        };
      }
    }

    const message: ResendPayload = {
      to: Array.isArray(options.to) ? options.to : [options.to],
      from: fromEmail,
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.replyTo,
      ...(headers ? { headers } : {}),
    };

    // Wrap provider call with a timeout to prevent hanging the booking flow
    const EMAIL_TIMEOUT_MS = 10_000;
    const response = await Promise.race([
      sendViaResend(message),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Resend request timed out')), EMAIL_TIMEOUT_MS)
      ),
    ]);
    const recipient = Array.isArray(options.to) ? `${options.to.length} recipients` : options.to.replace(/(.{2}).*@/, '$1***@');
    defaultLogger.info(`Email sent: ${options.subject} to ${recipient}`);
    return { success: true, messageId: response.id };
  } catch (error) {
    defaultLogger.error('❌ Error sending email:', error);
    throw error;
  }
}

export async function sendTransactionalEmail(options: EmailOptions): Promise<EmailSendResult> {
  return sendEmail({ ...options, marketing: false });
}

export async function sendMarketingEmail(options: EmailOptions): Promise<EmailSendResult> {
  return sendEmail({
    ...options,
    marketing: true,
    senderKey: options.senderKey || 'newsletter',
  });
}

export async function sendSupportEmail(options: EmailOptions): Promise<EmailSendResult> {
  return sendTransactionalEmail({
    ...options,
    senderKey: options.senderKey || 'support',
  });
}

/**
 * Send welcome email
 */
export async function sendWelcomeEmail(email: string, name: string) {
  return sendTransactionalEmail({
    to: email,
    senderKey: 'default',
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

  return sendTransactionalEmail({
    to: email,
    senderKey: 'bookings',
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
  return sendTransactionalEmail({
    to: email,
    senderKey: 'bookings',
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
  return sendTransactionalEmail({
    to: email,
    senderKey: 'bookings',
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
  return sendTransactionalEmail({
    to: email,
    senderKey: 'bookings',
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

  return sendTransactionalEmail({
    to: email,
    senderKey: 'billing',
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

export async function sendTenantInviteEmail(input: {
  to: string;
  inviteUrl: string;
  invitedRole: string;
  inviterEmail?: string | null;
  tenantName?: string | null;
}) {
  const tenantName = input.tenantName?.trim() || 'Booka';
  const inviter = input.inviterEmail?.trim();
  return sendSupportEmail({
    to: input.to,
    senderKey: 'support',
    replyTo: resolveSenderAddress('support'),
    subject: `You're invited to join ${tenantName} on Booka`,
    html: `
      <h2>You're invited to join ${escapeHtml(tenantName)}</h2>
      <p>You have been invited to join <strong>${escapeHtml(tenantName)}</strong> on Booka as <strong>${escapeHtml(input.invitedRole)}</strong>.</p>
      ${inviter ? `<p>Invited by: ${escapeHtml(inviter)}</p>` : ''}
      <p><a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">Accept invite</a></p>
      <p>If the button does not work, use this link:</p>
      <p><a href="${escapeHtml(input.inviteUrl)}">${escapeHtml(input.inviteUrl)}</a></p>
    `,
  });
}
