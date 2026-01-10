/**
 * Email Service - SendGrid Integration
 * 
 * Handles sending transactional emails via SendGrid
 * Includes pre-built templates for common use cases
 */

import sgMail from '@sendgrid/mail';

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
      console.warn('⚠️ SENDGRID_API_KEY not configured');
      return { success: false, error: 'SendGrid not configured' };
    }

    initSendGrid();

    const message = {
      to: options.to,
      from: options.from || (process.env.SENDGRID_FROM_EMAIL as string),
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    };

    const response = await sgMail.send(message);
    console.log(`✅ Email sent: ${options.subject} to ${options.to}`);
    return { success: true, messageId: response[0].headers['x-message-id'] };
  } catch (error) {
    console.error('❌ Error sending email:', error);
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
 * Send booking confirmation email
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
  }
) {
  return sendEmail({
    to: email,
    subject: 'Booking Confirmation - Boka',
    html: `
      <h2>Booking Confirmed!</h2>
      <p>Hi ${customerName},</p>
      <p>Your booking has been confirmed:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Service:</strong> ${bookingDetails.serviceName}</p>
        <p><strong>Date:</strong> ${bookingDetails.date}</p>
        <p><strong>Time:</strong> ${bookingDetails.time}</p>
        ${bookingDetails.location ? `<p><strong>Location:</strong> ${bookingDetails.location}</p>` : ''}
        ${bookingDetails.notes ? `<p><strong>Notes:</strong> ${bookingDetails.notes}</p>` : ''}
      </div>
      
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
      <p>Hi ${customerName},</p>
      <p>This is a friendly reminder about your upcoming booking:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Service:</strong> ${bookingDetails.serviceName}</p>
        <p><strong>Date:</strong> ${bookingDetails.date}</p>
        <p><strong>Time:</strong> ${bookingDetails.time}</p>
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
      <p>Hi ${customerName},</p>
      <p>Your booking has been cancelled:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Service:</strong> ${bookingDetails.serviceName}</p>
        <p><strong>Date:</strong> ${bookingDetails.date}</p>
        <p><strong>Time:</strong> ${bookingDetails.time}</p>
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
    subject: `New Booking Assignment - ${bookingDetails.serviceName}`,
    html: `
      <h2>You've been assigned a new booking</h2>
      <p>Hi ${staffName},</p>
      <p>A new booking has been assigned to you:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Customer:</strong> ${bookingDetails.customerName}</p>
        <p><strong>Service:</strong> ${bookingDetails.serviceName}</p>
        <p><strong>Date:</strong> ${bookingDetails.date}</p>
        <p><strong>Time:</strong> ${bookingDetails.time}</p>
        ${bookingDetails.notes ? `<p><strong>Notes:</strong> ${bookingDetails.notes}</p>` : ''}
      </div>
      
      <p>Please confirm your availability in the system.</p>
    `,
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(email: string, resetLink: string) {
  return sendEmail({
    to: email,
    subject: 'Reset your Boka password',
    html: `
      <h2>Password Reset Request</h2>
      <p>We received a request to reset your Boka password.</p>
      <p>Click the link below to reset your password (valid for 1 hour):</p>
      <p><a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  });
}

/**
 * Send verification email
 */
export async function sendVerificationEmail(email: string, verificationLink: string) {
  return sendEmail({
    to: email,
    subject: 'Verify your Boka email address',
    html: `
      <h2>Email Verification</h2>
      <p>Thank you for signing up for Boka. Please verify your email address by clicking the link below:</p>
      <p><a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
      <p>This link is valid for 24 hours.</p>
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
    .map((item) => `<tr><td>${item.description}</td><td>$${item.amount.toFixed(2)}</td></tr>`)
    .join('');

  return sendEmail({
    to: email,
    subject: `Invoice #${invoiceDetails.invoiceNumber} - Boka`,
    html: `
      <h2>Invoice</h2>
      <p>Hi ${customerName},</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
        <p><strong>Invoice #:</strong> ${invoiceDetails.invoiceNumber}</p>
        <p><strong>Date:</strong> ${invoiceDetails.date}</p>
        ${invoiceDetails.dueDate ? `<p><strong>Due Date:</strong> ${invoiceDetails.dueDate}</p>` : ''}
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
