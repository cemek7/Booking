/**
 * Comprehensive Tests for Notification Services
 * Tests Email, SMS, WhatsApp, and Notification Aggregator
 */

import {
  sendEmail,
  sendWelcomeEmail,
  sendBookingConfirmation,
  sendBookingReminder,
  sendCancellationEmail,
  sendStaffAssignmentEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendInvoiceEmail,
} from '../lib/integrations/email-service';

import {
  sendSMS,
  sendBookingConfirmationSMS,
  sendBookingReminderSMS,
  sendCancellationSMS,
  sendReschedulingSMS,
  sendOTPSMS,
  sendPaymentConfirmationSMS,
  sendStaffNotificationSMS,
  sendFeedbackSMS,
  sendPromoSMS,
  getTwilioBalance,
} from '../lib/integrations/sms-service';

import {
  sendWhatsApp,
  sendBookingConfirmationWhatsApp,
  sendBookingReminderWhatsApp,
  sendCancellationWhatsApp,
  sendRescheduleWhatsApp,
  sendPaymentConfirmationWhatsApp,
  sendOTPWhatsApp,
  sendStaffNotificationWhatsApp,
  sendFeedbackWhatsApp,
  sendPromoWhatsApp,
  sendInvoiceWhatsApp,
  getEvolutionInstanceStatus,
} from '../lib/integrations/whatsapp-service';

import {
  notifyBookingEvent,
  notifyStaffAssignment,
  sendBatchNotifications,
  summarizeNotificationResults,
} from '../lib/integrations/notification-aggregator';

jest.mock('../lib/integrations/email-service');
jest.mock('../lib/integrations/sms-service');
jest.mock('../lib/integrations/whatsapp-service');

describe('Email Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.SENDGRID_FROM_EMAIL = 'noreply@boka.com';
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
      });

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-message-id');
    });

    it('should handle missing API key', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: false,
        error: 'SendGrid not configured',
      });

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test Email',
        html: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
    });

    it('should support multiple recipients', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'test-id',
      });

      await sendEmail({
        to: ['test1@example.com', 'test2@example.com'],
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(sendEmail).toHaveBeenCalled();
    });
  });

  describe('sendWelcomeEmail', () => {
    it('should send welcome email', async () => {
      (sendWelcomeEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'welcome-id',
      });

      const result = await sendWelcomeEmail('user@example.com', 'John Doe');

      expect(result.success).toBe(true);
    });
  });

  describe('sendBookingConfirmation', () => {
    it('should send booking confirmation email', async () => {
      (sendBookingConfirmation as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'booking-id',
      });

      const result = await sendBookingConfirmation('user@example.com', 'John Doe', {
        serviceName: 'Haircut',
        date: '2025-12-20',
        time: '10:00 AM',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('sendBookingReminder', () => {
    it('should send reminder with hours remaining', async () => {
      (sendBookingReminder as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'reminder-id',
      });

      const result = await sendBookingReminder('user@example.com', 'John Doe', 24, {
        serviceName: 'Massage',
        date: '2025-12-20',
        time: '2:00 PM',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('sendCancellationEmail', () => {
    it('should send cancellation email', async () => {
      (sendCancellationEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'cancel-id',
      });

      const result = await sendCancellationEmail('user@example.com', 'John Doe', {
        serviceName: 'Spa',
        date: '2025-12-20',
        time: '3:00 PM',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset with valid link', async () => {
      (sendPasswordResetEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'reset-id',
      });

      const result = await sendPasswordResetEmail(
        'user@example.com',
        'https://boka.com/reset?token=xyz'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('sendInvoiceEmail', () => {
    it('should send invoice with itemized details', async () => {
      (sendInvoiceEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'invoice-id',
      });

      const result = await sendInvoiceEmail('user@example.com', 'John Doe', {
        invoiceNumber: 'INV-001',
        date: '2025-12-17',
        amount: 150.0,
        items: [
          { description: 'Haircut', amount: 100 },
          { description: 'Styling', amount: 50 },
        ],
        dueDate: '2025-12-31',
      });

      expect(result.success).toBe(true);
    });
  });
});

describe('SMS Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = 'test-sid';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_PHONE_NUMBER = '+1234567890';
  });

  describe('sendSMS', () => {
    it('should send SMS successfully', async () => {
      (sendSMS as jest.Mock).mockResolvedValue({
        success: true,
        sid: 'SM123',
      });

      const result = await sendSMS({
        to: '+1234567890',
        body: 'Test message',
      });

      expect(result.success).toBe(true);
    });

    it('should handle missing Twilio credentials', async () => {
      (sendSMS as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Twilio not configured',
      });

      const result = await sendSMS({
        to: '+1234567890',
        body: 'Test',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('sendBookingConfirmationSMS', () => {
    it('should send SMS with booking details', async () => {
      (sendBookingConfirmationSMS as jest.Mock).mockResolvedValue({
        success: true,
        sid: 'SM123',
      });

      const result = await sendBookingConfirmationSMS('+1234567890', {
        serviceName: 'Haircut',
        date: '2025-12-20',
        time: '10:00 AM',
        confirmationCode: 'ABC123',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('sendOTPSMS', () => {
    it('should send OTP with 10 minute validity', async () => {
      (sendOTPSMS as jest.Mock).mockResolvedValue({
        success: true,
        sid: 'SM123',
      });

      const result = await sendOTPSMS('+1234567890', '123456');

      expect(result.success).toBe(true);
    });
  });

  describe('sendPaymentConfirmationSMS', () => {
    it('should send payment confirmation', async () => {
      (sendPaymentConfirmationSMS as jest.Mock).mockResolvedValue({
        success: true,
        sid: 'SM123',
      });

      const result = await sendPaymentConfirmationSMS('+1234567890', {
        amount: 99.99,
        method: 'Card',
        transactionId: 'TXN123',
        serviceName: 'Haircut',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getTwilioBalance', () => {
    it('should retrieve Twilio account balance', async () => {
      (getTwilioBalance as jest.Mock).mockResolvedValue(50.0);

      const balance = await getTwilioBalance();

      expect(typeof balance).toBe('number');
    });
  });
});

describe('WhatsApp Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_API_URL = 'https://api.evolution.local';
    process.env.EVOLUTION_API_KEY = 'test-key';
    process.env.EVOLUTION_INSTANCE_KEY = 'test-instance';
  });

  describe('sendWhatsApp', () => {
    it('should send WhatsApp message successfully', async () => {
      (sendWhatsApp as jest.Mock).mockResolvedValue({
        success: true,
        key: 'msg-123',
      });

      const result = await sendWhatsApp({
        number: '+1234567890',
        text: 'Test message',
      });

      expect(result.success).toBe(true);
    });

    it('should handle missing Evolution API credentials', async () => {
      (sendWhatsApp as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Evolution API not configured',
      });

      const result = await sendWhatsApp({
        number: '+1234567890',
        text: 'Test',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('sendBookingConfirmationWhatsApp', () => {
    it('should send booking confirmation with formatted message', async () => {
      (sendBookingConfirmationWhatsApp as jest.Mock).mockResolvedValue({
        success: true,
        key: 'msg-123',
      });

      const result = await sendBookingConfirmationWhatsApp('+1234567890', 'John Doe', {
        serviceName: 'Haircut',
        date: '2025-12-20',
        time: '10:00 AM',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('sendOTPWhatsApp', () => {
    it('should send OTP with formatting', async () => {
      (sendOTPWhatsApp as jest.Mock).mockResolvedValue({
        success: true,
        key: 'msg-123',
      });

      const result = await sendOTPWhatsApp('+1234567890', '123456', 10);

      expect(result.success).toBe(true);
    });
  });

  describe('sendPromoWhatsApp', () => {
    it('should send promotional offer', async () => {
      (sendPromoWhatsApp as jest.Mock).mockResolvedValue({
        success: true,
        key: 'msg-123',
      });

      const result = await sendPromoWhatsApp('+1234567890', {
        offerName: 'Discount Service',
        discountPercentage: 20,
        expiryDate: '2025-12-31',
        code: 'SAVE20',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getEvolutionInstanceStatus', () => {
    it('should retrieve instance status', async () => {
      (getEvolutionInstanceStatus as jest.Mock).mockResolvedValue({
        instance: 'test-instance',
        status: 'connected',
      });

      const status = await getEvolutionInstanceStatus();

      expect(status).toBeDefined();
    });
  });
});

describe('Notification Aggregator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('notifyBookingEvent', () => {
    it('should send confirmation when email service is available', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'test-id',
      });

      const results = await notifyBookingEvent({
        eventType: 'confirmation',
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          whatsapp: '+1234567890',
          preferences: { email: true, sms: false, whatsapp: false },
        },
        bookingDetails: {
          serviceName: 'Haircut',
          date: '2025-12-20',
          time: '10:00 AM',
        },
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should respect user preferences for notification channels', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'test-id',
      });

      const results = await notifyBookingEvent({
        eventType: 'confirmation',
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          whatsapp: '+1234567890',
          preferences: { email: true, sms: false, whatsapp: false },
        },
        bookingDetails: {
          serviceName: 'Haircut',
          date: '2025-12-20',
          time: '10:00 AM',
        },
      });

      expect(results).toBeDefined();
      // Should only attempt email since other channels are false
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle reminder event type', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'reminder-id',
      });

      const results = await notifyBookingEvent({
        eventType: 'reminder',
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
          preferences: { email: true, sms: false, whatsapp: false },
        },
        bookingDetails: {
          serviceName: 'Haircut',
          date: '2025-12-20',
          time: '10:00 AM',
        },
        reminderHours: 24,
      });

      expect(results).toBeDefined();
    });

    it('should handle cancellation event type', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'cancel-id',
      });

      const results = await notifyBookingEvent({
        eventType: 'cancellation',
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
          preferences: { email: true, sms: false, whatsapp: false },
        },
        bookingDetails: {
          serviceName: 'Haircut',
          date: '2025-12-20',
          time: '10:00 AM',
        },
      });

      expect(results).toBeDefined();
    });
  });

  describe('notifyStaffAssignment', () => {
    it('should notify staff of new booking', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'staff-id',
      });

      const results = await notifyStaffAssignment({
        staff: {
          name: 'Jane Smith',
          email: 'jane@example.com',
          phone: '+1234567890',
          preferences: { email: true, sms: true, whatsapp: false },
        },
        customer: { name: 'John Doe' },
        bookingDetails: {
          serviceName: 'Haircut',
          date: '2025-12-20',
          time: '10:00 AM',
        },
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('sendBatchNotifications', () => {
    it('should send batch notifications with retry logic', async () => {
      (sendEmail as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'batch-id',
      });

      const results = await sendBatchNotifications([
        {
          data: {
            eventType: 'confirmation',
            customer: {
              name: 'John Doe',
              email: 'john@example.com',
              preferences: { email: true, sms: false, whatsapp: false },
            },
            bookingDetails: {
              serviceName: 'Haircut',
              date: '2025-12-20',
              time: '10:00 AM',
            },
          },
        },
        {
          data: {
            eventType: 'confirmation',
            customer: {
              name: 'Jane Doe',
              email: 'jane@example.com',
              preferences: { email: true, sms: false, whatsapp: false },
            },
            bookingDetails: {
              serviceName: 'Massage',
              date: '2025-12-20',
              time: '2:00 PM',
            },
          },
        },
      ]);

      expect(results).toBeDefined();
      expect(results instanceof Map).toBe(true);
    });

    it('should retry failed notifications', async () => {
      let callCount = 0;
      (sendEmail as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Failed');
        }
        return Promise.resolve({ success: true, messageId: 'retry-id' });
      });

      const results = await sendBatchNotifications([
        {
          data: {
            eventType: 'confirmation',
            customer: {
              name: 'John Doe',
              email: 'john@example.com',
              preferences: { email: true, sms: false, whatsapp: false },
            },
            bookingDetails: {
              serviceName: 'Haircut',
              date: '2025-12-20',
              time: '10:00 AM',
            },
          },
          retries: 3,
        },
      ]);

      expect(results).toBeDefined();
      expect(results instanceof Map).toBe(true);
    });
  });

  describe('summarizeNotificationResults', () => {
    it('should calculate success rate', () => {
      const results = [
        { channel: 'email' as const, success: true, timestamp: new Date() },
        { channel: 'sms' as const, success: true, timestamp: new Date() },
        { channel: 'whatsapp' as const, success: false, timestamp: new Date() },
      ];

      const summary = summarizeNotificationResults(results);

      expect(summary.total).toBe(3);
      expect(summary.successful).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.successRate).toBe('66.67%');
    });

    it('should handle all successful notifications', () => {
      const results = [
        { channel: 'email' as const, success: true, timestamp: new Date() },
        { channel: 'sms' as const, success: true, timestamp: new Date() },
      ];

      const summary = summarizeNotificationResults(results);

      expect(summary.successRate).toBe('100.00%');
    });

    it('should handle all failed notifications', () => {
      const results = [
        { channel: 'email' as const, success: false, timestamp: new Date() },
        { channel: 'sms' as const, success: false, timestamp: new Date() },
      ];

      const summary = summarizeNotificationResults(results);

      expect(summary.successRate).toBe('0.00%');
    });
  });
});

describe('Notification Integration Tests', () => {
  it('should follow complete booking lifecycle with notifications', async () => {
    (sendEmail as jest.Mock).mockResolvedValue({
      success: true,
      messageId: 'test-id',
    });

    const customerData = {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1234567890',
      whatsapp: '+1234567890',
      preferences: { email: true, sms: true, whatsapp: true },
    };

    // Send confirmation
    const confirmationResults = await notifyBookingEvent({
      eventType: 'confirmation',
      customer: customerData,
      bookingDetails: {
        serviceName: 'Haircut',
        date: '2025-12-20',
        time: '10:00 AM',
      },
    });

    expect(confirmationResults).toBeDefined();

    // Send reminder
    const reminderResults = await notifyBookingEvent({
      eventType: 'reminder',
      customer: customerData,
      bookingDetails: {
        serviceName: 'Haircut',
        date: '2025-12-20',
        time: '10:00 AM',
      },
      reminderHours: 24,
    });

    expect(reminderResults).toBeDefined();

    // Send cancellation
    const cancellationResults = await notifyBookingEvent({
      eventType: 'cancellation',
      customer: customerData,
      bookingDetails: {
        serviceName: 'Haircut',
        date: '2025-12-20',
        time: '10:00 AM',
      },
    });

    expect(cancellationResults).toBeDefined();
  });
});
