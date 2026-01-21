import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock SendGrid
jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(() =>
      Promise.resolve([
        {
          statusCode: 202,
          headers: {
            'x-message-id': 'mock-message-id-12345',
          },
        },
      ])
    ),
  },
}));

// Import after mocks
import {
  sendEmail,
  sendWelcomeEmail,
  sendBookingConfirmation,
} from '@/lib/integrations/email-service';

describe('Email Service - Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set environment variable for tests
    process.env.SENDGRID_API_KEY = 'test-api-key';
    process.env.SENDGRID_FROM_EMAIL = 'noreply@boka.com';
  });

  describe('EmailOptions Interface', () => {
    it('should accept single recipient', async () => {
      const options = {
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      };

      await sendEmail(options);
      expect(options.to).toBe('user@example.com');
    });

    it('should accept multiple recipients', async () => {
      const options = {
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test Email',
        html: '<p>Test content</p>',
      };

      await sendEmail(options);
      expect(Array.isArray(options.to)).toBe(true);
      expect(options.to.length).toBe(2);
    });

    it('should accept optional text content', async () => {
      const options = {
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
        text: 'Test content',
      };

      await sendEmail(options);
      expect(options.text).toBe('Test content');
    });

    it('should accept optional replyTo', async () => {
      const options = {
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
        replyTo: 'support@boka.com',
      };

      await sendEmail(options);
      expect(options.replyTo).toBe('support@boka.com');
    });

    it('should accept optional custom from address', async () => {
      const options = {
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
        from: 'custom@boka.com',
      };

      await sendEmail(options);
      expect(options.from).toBe('custom@boka.com');
    });
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('mock-message-id-12345');
    });

    it('should use default from address when not provided', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(sgMail.send).toHaveBeenCalled();
      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.from).toBe('noreply@boka.com');
    });

    it('should use custom from address when provided', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        from: 'custom@boka.com',
      });

      expect(sgMail.send).toHaveBeenCalled();
      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.from).toBe('custom@boka.com');
    });

    it('should handle missing API key gracefully', async () => {
      delete process.env.SENDGRID_API_KEY;

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('SendGrid not configured');
    });

    it('should include all email fields', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<h1>Test HTML</h1>',
        text: 'Test Text',
        replyTo: 'support@boka.com',
      });

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.to).toBe('user@example.com');
      expect(callArgs.subject).toBe('Test Subject');
      expect(callArgs.html).toContain('Test HTML');
      expect(callArgs.text).toBe('Test Text');
      expect(callArgs.replyTo).toBe('support@boka.com');
    });
  });

  describe('sendWelcomeEmail', () => {
    it('should send welcome email with correct structure', async () => {
      const result = await sendWelcomeEmail('newuser@example.com', 'John Doe');

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should include user name in email', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendWelcomeEmail('newuser@example.com', 'Jane Smith');

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Jane Smith');
    });

    it('should have correct subject line', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendWelcomeEmail('newuser@example.com', 'John Doe');

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.subject).toBe('Welcome to Boka!');
    });

    it('should include getting started instructions', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendWelcomeEmail('newuser@example.com', 'John Doe');

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Creating your first service');
      expect(callArgs.html).toContain('Adding your staff members');
      expect(callArgs.html).toContain('Setting up your availability');
    });

    it('should send to correct recipient', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendWelcomeEmail('test@example.com', 'Test User');

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.to).toBe('test@example.com');
    });
  });

  describe('sendBookingConfirmation', () => {
    const bookingDetails = {
      serviceName: 'Haircut',
      date: '2024-01-20',
      time: '2:00 PM',
      location: '123 Main St',
      notes: 'Please arrive 5 minutes early',
    };

    it('should send booking confirmation successfully', async () => {
      const result = await sendBookingConfirmation(
        'customer@example.com',
        'Alice Johnson',
        bookingDetails
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should include customer name', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', bookingDetails);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Alice Johnson');
    });

    it('should include service name', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', bookingDetails);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Haircut');
    });

    it('should include date and time', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', bookingDetails);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('2024-01-20');
      expect(callArgs.html).toContain('2:00 PM');
    });

    it('should include location when provided', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', bookingDetails);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('123 Main St');
    });

    it('should include notes when provided', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', bookingDetails);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Please arrive 5 minutes early');
    });

    it('should handle booking without location', async () => {
      const sgMail = require('@sendgrid/mail').default;

      const detailsWithoutLocation = {
        serviceName: 'Consultation',
        date: '2024-01-21',
        time: '10:00 AM',
      };

      await sendBookingConfirmation(
        'customer@example.com',
        'Bob Smith',
        detailsWithoutLocation
      );

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Consultation');
      expect(callArgs.html).toContain('2024-01-21');
    });

    it('should handle booking without notes', async () => {
      const sgMail = require('@sendgrid/mail').default;

      const detailsWithoutNotes = {
        serviceName: 'Massage',
        date: '2024-01-22',
        time: '3:00 PM',
        location: '456 Oak Ave',
      };

      await sendBookingConfirmation('customer@example.com', 'Carol White', detailsWithoutNotes);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.html).toContain('Massage');
      expect(callArgs.html).toContain('456 Oak Ave');
    });

    it('should have correct subject line', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', bookingDetails);

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.subject).toBe('Booking Confirmation - Boka');
    });
  });

  describe('Error Handling', () => {
    it('should handle SendGrid API errors', async () => {
      const sgMail = require('@sendgrid/mail').default;
      const mockError = new Error('SendGrid API error');

      (sgMail.send as jest.Mock).mockRejectedValueOnce(mockError);

      await expect(
        sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow('SendGrid API error');
    });

    it('should handle network errors', async () => {
      const sgMail = require('@sendgrid/mail').default;
      const networkError = new Error('Network timeout');

      (sgMail.send as jest.Mock).mockRejectedValueOnce(networkError);

      await expect(
        sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow('Network timeout');
    });

    it('should handle invalid email addresses', async () => {
      const sgMail = require('@sendgrid/mail').default;
      const invalidEmailError = new Error('Invalid email address');

      (sgMail.send as jest.Mock).mockRejectedValueOnce(invalidEmailError);

      await expect(
        sendEmail({
          to: 'invalid-email',
          subject: 'Test',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow('Invalid email address');
    });
  });

  describe('Configuration', () => {
    it('should initialize SendGrid with API key', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(sgMail.setApiKey).toHaveBeenCalledWith('test-api-key');
    });

    it('should use environment variable for from email', async () => {
      const sgMail = require('@sendgrid/mail').default;

      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.from).toBe('noreply@boka.com');
    });

    it('should handle missing from email gracefully', async () => {
      delete process.env.SENDGRID_FROM_EMAIL;
      const sgMail = require('@sendgrid/mail').default;

      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        from: 'fallback@boka.com',
      });

      const callArgs = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(callArgs.from).toBe('fallback@boka.com');
    });
  });
});
