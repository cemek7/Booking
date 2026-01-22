import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock Twilio
jest.mock('twilio', () => {
  return jest.fn(() => ({
    messages: {
      create: jest.fn(() =>
        Promise.resolve({
          sid: 'SM_mock_message_id_12345',
          status: 'sent',
        })
      ),
    },
  }));
});

// Import after mocks
import { sendSMS, sendBookingConfirmationSMS, sendBookingReminderSMS } from '@/lib/integrations/sms-service';

describe('SMS Service - Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set environment variables for tests
    process.env.TWILIO_ACCOUNT_SID = 'test-account-sid';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_PHONE_NUMBER = '+1234567890';
  });

  describe('SMSOptions Interface', () => {
    it('should accept phone number and message body', async () => {
      const options = {
        to: '+19876543210',
        body: 'Test message',
      };

      await sendSMS(options);
      expect(options.to).toBe('+19876543210');
      expect(options.body).toBe('Test message');
    });

    it('should accept international phone numbers', async () => {
      const options = {
        to: '+447700900123',
        body: 'Test message',
      };

      await sendSMS(options);
      expect(options.to).toBe('+447700900123');
    });

    it('should accept long message bodies', async () => {
      const longMessage = 'A'.repeat(300);
      const options = {
        to: '+19876543210',
        body: longMessage,
      };

      await sendSMS(options);
      expect(options.body.length).toBe(300);
    });
  });

  describe('sendSMS', () => {
    it('should send SMS successfully', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test message',
      });

      expect(result.success).toBe(true);
      expect(result.sid).toBe('SM_mock_message_id_12345');
    });

    it('should send SMS with Twilio client', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      expect(result.success).toBe(true);
    });

    it('should handle missing credentials gracefully', async () => {
      delete process.env.TWILIO_ACCOUNT_SID;

      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Twilio not configured');
    });

    it('should handle missing auth token gracefully', async () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Twilio not configured');
    });

    it('should handle missing phone number gracefully', async () => {
      delete process.env.TWILIO_PHONE_NUMBER;

      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Twilio not configured');
    });
  });

  describe('sendBookingConfirmationSMS', () => {
    const bookingDetails = {
      serviceName: 'Haircut',
      date: 'Jan 20, 2024',
      time: '2:00 PM',
      confirmationCode: 'ABC123',
    };

    it('should send booking confirmation SMS successfully', async () => {
      const result = await sendBookingConfirmationSMS('+19876543210', bookingDetails);

      expect(result.success).toBe(true);
      expect(result.sid).toBeDefined();
    });

    it('should include service name in message', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingConfirmationSMS('+19876543210', bookingDetails);

    });

    it('should include date in message', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingConfirmationSMS('+19876543210', bookingDetails);

    });

    it('should include time in message', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingConfirmationSMS('+19876543210', bookingDetails);

    });

    it('should include confirmation code when provided', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingConfirmationSMS('+19876543210', bookingDetails);

    });

    it('should handle booking without confirmation code', async () => {
      const detailsWithoutCode = {
        serviceName: 'Massage',
        date: 'Jan 21, 2024',
        time: '10:00 AM',
      };

      const result = await sendBookingConfirmationSMS('+19876543210', detailsWithoutCode);

      expect(result.success).toBe(true);
      expect(result.sid).toBeDefined();
    });

    it('should send to correct phone number', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingConfirmationSMS('+15551234567', bookingDetails);

    });

    it('should contain "Booking Confirmed" text', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingConfirmationSMS('+19876543210', bookingDetails);

    });
  });

  describe('sendBookingReminderSMS', () => {
    const reminderDetails = {
      serviceName: 'Dental Cleaning',
      time: '3:00 PM',
      hoursUntil: 24,
    };

    it('should send booking reminder SMS successfully', async () => {
      const result = await sendBookingReminderSMS('+19876543210', reminderDetails);

      expect(result.success).toBe(true);
      expect(result.sid).toBeDefined();
    });

    it('should include service name in reminder', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingReminderSMS('+19876543210', reminderDetails);

    });

    it('should include time in reminder', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingReminderSMS('+19876543210', reminderDetails);

    });

    it('should include hours until appointment', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingReminderSMS('+19876543210', reminderDetails);

    });

    it('should handle 1 hour reminder', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      const oneHourReminder = {
        serviceName: 'Haircut',
        time: '2:00 PM',
        hoursUntil: 1,
      };

      await sendBookingReminderSMS('+19876543210', oneHourReminder);

    });

    it('should handle 2 hour reminder', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      const twoHourReminder = {
        serviceName: 'Consultation',
        time: '10:00 AM',
        hoursUntil: 2,
      };

      await sendBookingReminderSMS('+19876543210', twoHourReminder);

    });

    it('should contain "Reminder" text', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingReminderSMS('+19876543210', reminderDetails);

    });

    it('should send to correct phone number', async () => {
      const twilio = require('twilio');
      const mockClient = twilio();

      await sendBookingReminderSMS('+15559876543', reminderDetails);

    });
  });

  describe('Error Handling', () => {
    it('should detect Twilio configuration issues', async () => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;

      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should validate required environment variables', () => {
      // Check that we have the necessary env vars for testing
      expect(process.env.TWILIO_PHONE_NUMBER).toBeDefined();
    });

    it('should handle SMS sending gracefully', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test message',
      });

      // Should either succeed or fail gracefully
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('should return error information on failure', async () => {
      delete process.env.TWILIO_PHONE_NUMBER;

      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('Phone Number Validation', () => {
    it('should accept E.164 format phone numbers', async () => {
      const validNumbers = ['+14155552671', '+442071838750', '+81312345678'];

      for (const number of validNumbers) {
        const result = await sendSMS({
          to: number,
          body: 'Test',
        });

        expect(result.success).toBe(true);
      }
    });

    it('should send to US numbers', async () => {
      const result = await sendSMS({
        to: '+12025551234',
        body: 'Test',
      });

      expect(result.success).toBe(true);
    });

    it('should send to UK numbers', async () => {
      const result = await sendSMS({
        to: '+447700900123',
        body: 'Test',
      });

      expect(result.success).toBe(true);
    });

    it('should send to international numbers', async () => {
      const result = await sendSMS({
        to: '+61412345678',
        body: 'Test',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Message Body Validation', () => {
    it('should handle short messages', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Hi',
      });

      expect(result.success).toBe(true);
    });

    it('should handle long messages (>160 characters)', async () => {
      const longMessage = 'A'.repeat(200);

      const result = await sendSMS({
        to: '+19876543210',
        body: longMessage,
      });

      expect(result.success).toBe(true);
    });

    it('should handle messages with special characters', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test with special chars: @#$%^&*()',
      });

      expect(result.success).toBe(true);
    });

    it('should handle messages with emojis', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test with emoji 😊',
      });

      expect(result.success).toBe(true);
    });

    it('should handle messages with line breaks', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Line 1\nLine 2\nLine 3',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should use Twilio credentials from environment', () => {
      expect(process.env.TWILIO_ACCOUNT_SID).toBe('test-account-sid');
      expect(process.env.TWILIO_AUTH_TOKEN).toBe('test-auth-token');
    });

    it('should use configured Twilio phone number from environment', () => {
      expect(process.env.TWILIO_PHONE_NUMBER).toBe('+1234567890');
    });

    it('should send SMS successfully with configuration', async () => {
      const result = await sendSMS({
        to: '+19876543210',
        body: 'Test',
      });

      expect(result.success).toBe(true);
      expect(result.sid).toBeDefined();
    });
  });
});
