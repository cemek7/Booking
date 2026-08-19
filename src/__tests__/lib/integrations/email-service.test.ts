import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const fetchMock = jest.fn<typeof fetch>();
global.fetch = fetchMock as typeof fetch;

jest.mock('@/lib/email/preferences', () => ({
  isUnsubscribed: jest.fn(async () => false),
}));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => ({}) }));

import {
  sendEmail,
  sendWelcomeEmail,
  sendBookingConfirmation,
  sendBookingReminder,
  sendCancellationEmail,
  sendStaffAssignmentEmail,
  sendInvoiceEmail,
  sendTenantInviteEmail,
} from '@/lib/integrations/email-service';

function getPayload() {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

describe('Email Service - Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_api_key';
    process.env.EMAIL_DEFAULT_FROM = 'noreply@mail.techclave.cloud';
    process.env.EMAIL_SUPPORT_FROM = 'support@mail.techclave.cloud';
    process.env.EMAIL_BOOKINGS_FROM = 'bookings@mail.techclave.cloud';
    process.env.EMAIL_BILLING_FROM = 'billing@mail.techclave.cloud';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mock-message-id-12345' }),
      text: async () => '',
      status: 200,
      statusText: 'OK',
    } as Response);
  });

  describe('sendEmail', () => {
    it('sends email successfully', async () => {
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('mock-message-id-12345');
    });

    it('uses the default sender when one is not provided', async () => {
      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(getPayload().from).toBe('noreply@mail.techclave.cloud');
    });

    it('uses senderKey mapping when provided', async () => {
      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        senderKey: 'support',
      });

      expect(getPayload().from).toBe('support@mail.techclave.cloud');
    });

    it('uses custom from address when provided', async () => {
      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        from: 'custom@mail.techclave.cloud',
      });

      expect(getPayload().from).toBe('custom@mail.techclave.cloud');
    });

    it('includes text and reply_to fields', async () => {
      await sendEmail({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test Subject',
        html: '<h1>Test HTML</h1>',
        text: 'Test Text',
        replyTo: 'support@mail.techclave.cloud',
      });

      const payload = getPayload();
      expect(payload.to).toEqual(['user1@example.com', 'user2@example.com']);
      expect(payload.text).toBe('Test Text');
      expect(payload.reply_to).toBe('support@mail.techclave.cloud');
    });

    it('handles missing API key gracefully', async () => {
      delete process.env.RESEND_API_KEY;

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Resend not configured');
    });

    it('handles provider errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Invalid email address',
        status: 422,
        statusText: 'Unprocessable Entity',
      } as Response);

      await expect(
        sendEmail({
          to: 'invalid-email',
          subject: 'Test',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow('Resend API error');
    });

    it('sends with authorization header', async () => {
      await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer re_test_api_key',
      });
    });
  });

  describe('transactional helpers', () => {
    it('sendWelcomeEmail includes the user name', async () => {
      await sendWelcomeEmail('newuser@example.com', 'Jane Smith');
      const payload = getPayload();
      expect(payload.subject).toBe('Welcome to Boka!');
      expect(String(payload.html)).toContain('Jane Smith');
      expect(payload.from).toBe('noreply@mail.techclave.cloud');
    });

    it('sendBookingConfirmation uses bookings sender and includes details', async () => {
      await sendBookingConfirmation('customer@example.com', 'Alice Johnson', {
        serviceName: 'Haircut',
        date: '2024-01-20',
        time: '2:00 PM',
        location: '123 Main St',
        notes: 'Please arrive 5 minutes early',
      });

      const payload = getPayload();
      expect(payload.subject).toBe('Booking Confirmation - Boka');
      expect(payload.from).toBe('bookings@mail.techclave.cloud');
      expect(String(payload.html)).toContain('Alice Johnson');
      expect(String(payload.html)).toContain('123 Main St');
    });

    it('sendBookingReminder uses bookings sender', async () => {
      await sendBookingReminder('customer@example.com', 'Ada', 24, {
        serviceName: 'Massage',
        date: '2024-01-21',
        time: '10:00 AM',
      });

      expect(getPayload().from).toBe('bookings@mail.techclave.cloud');
    });

    it('sendCancellationEmail uses bookings sender', async () => {
      await sendCancellationEmail('customer@example.com', 'Ada', {
        serviceName: 'Consultation',
        date: '2024-01-21',
        time: '10:00 AM',
      });

      expect(getPayload().from).toBe('bookings@mail.techclave.cloud');
    });

    it('sendStaffAssignmentEmail uses bookings sender', async () => {
      await sendStaffAssignmentEmail('staff@example.com', 'Grace', {
        customerName: 'Ada',
        serviceName: 'Consultation',
        date: '2024-01-21',
        time: '10:00 AM',
      });

      expect(getPayload().from).toBe('bookings@mail.techclave.cloud');
    });

    it('sendInvoiceEmail uses billing sender', async () => {
      await sendInvoiceEmail('user@example.com', 'John Doe', {
        invoiceNumber: 'INV-001',
        date: '2025-12-17',
        amount: 150,
        items: [
          { description: 'Haircut', amount: 100 },
          { description: 'Styling', amount: 50 },
        ],
      });

      const payload = getPayload();
      expect(payload.from).toBe('billing@mail.techclave.cloud');
      expect(String(payload.html)).toContain('INV-001');
    });

    it('sendTenantInviteEmail uses support sender and includes invite url', async () => {
      await sendTenantInviteEmail({
        to: 'invitee@example.com',
        inviteUrl: 'https://app.techclave.cloud/accept-invite?token=abc',
        invitedRole: 'staff',
        inviterEmail: 'owner@techclave.cloud',
        tenantName: 'Booka HQ',
      });

      const payload = getPayload();
      expect(payload.from).toBe('support@mail.techclave.cloud');
      expect(payload.reply_to).toBe('support@mail.techclave.cloud');
      expect(String(payload.html)).toContain('accept-invite?token=abc');
      expect(String(payload.html)).toContain('Booka HQ');
    });
  });
});
