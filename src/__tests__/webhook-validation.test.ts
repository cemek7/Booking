import {
  verifyStripeSignature,
  verifyPaystackSignature,
} from '@/lib/webhooks/validation';
import crypto from 'crypto';

describe('Webhook Signature Validation', () => {
  const stripeSecret = 'whsec_test_stripe_secret_key';
  const paystackSecret = 'test_paystack_secret_key_for_webhooks';

  describe('Stripe Signature Verification', () => {
    it('should reject missing signature', () => {
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const result = verifyStripeSignature(body, undefined, stripeSecret);
      expect(result).toBe(false);
    });

    it('should reject null signature', () => {
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const result = verifyStripeSignature(body, null, stripeSecret);
      expect(result).toBe(false);
    });

    it('should reject invalid signature format', () => {
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const result = verifyStripeSignature(
        body,
        'invalid_format_no_equals',
        stripeSecret
      );
      expect(result).toBe(false);
    });

    it('should reject invalid signature value', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signature = `t=${timestamp},v1=invalid_signature_value_here`;

      const result = verifyStripeSignature(body, signature, stripeSecret);
      expect(result).toBe(false);
    });

    it('should accept valid signature with current timestamp', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;
      const result = verifyStripeSignature(body, headerSignature, stripeSecret);
      expect(result).toBe(true);
    });

    it('should accept valid signature with recent timestamp (within 5 min)', () => {
      const timestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;
      const result = verifyStripeSignature(body, headerSignature, stripeSecret);
      expect(result).toBe(true);
    });

    it('should reject timestamp older than 5 minutes', () => {
      const timestamp = Math.floor(Date.now() / 1000) - 400; // 6+ minutes ago
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;
      const result = verifyStripeSignature(body, headerSignature, stripeSecret);
      expect(result).toBe(false);
    });

    it('should reject future timestamp (more than 1 minute)', () => {
      const timestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;
      const result = verifyStripeSignature(body, headerSignature, stripeSecret);
      expect(result).toBe(false);
    });

    it('should reject tampered body content', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;

      // Try with different body
      const tamperedBody = JSON.stringify({
        test: 'different',
        type: 'charge.refunded',
      });
      const result = verifyStripeSignature(
        tamperedBody,
        headerSignature,
        stripeSecret
      );
      expect(result).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;

      // Try with different secret
      const result = verifyStripeSignature(
        body,
        headerSignature,
        'wrong_secret_key'
      );
      expect(result).toBe(false);
    });

    it('should handle multiple v1 signatures in header', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data', type: 'charge.succeeded' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      // Stripe may send multiple signatures - we use the last valid one
      const headerSignature = `t=${timestamp},v1=invalid_sig,v1=${expectedSignature}`;
      const result = verifyStripeSignature(body, headerSignature, stripeSecret);
      // This should extract the correct signature
      expect(result).toBe(true);
    });
  });

  describe('Paystack Signature Verification', () => {
    it('should reject missing signature', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref123' },
      });
      const result = verifyPaystackSignature(body, undefined, paystackSecret);
      expect(result).toBe(false);
    });

    it('should reject null signature', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref123' },
      });
      const result = verifyPaystackSignature(body, null, paystackSecret);
      expect(result).toBe(false);
    });

    it('should reject invalid signature', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref123' },
      });
      const result = verifyPaystackSignature(
        body,
        'invalid_signature_here',
        paystackSecret
      );
      expect(result).toBe(false);
    });

    it('should accept valid signature', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref123' },
      });
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      const result = verifyPaystackSignature(
        body,
        expectedSignature,
        paystackSecret
      );
      expect(result).toBe(true);
    });

    it('should reject tampered body', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref123' },
      });
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      // Try with different body
      const tamperedBody = JSON.stringify({
        event: 'charge.failed',
        data: { reference: 'ref456' },
      });
      const result = verifyPaystackSignature(
        tamperedBody,
        expectedSignature,
        paystackSecret
      );
      expect(result).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref123' },
      });
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      // Try with different secret
      const result = verifyPaystackSignature(
        body,
        expectedSignature,
        'wrong_secret_key'
      );
      expect(result).toBe(false);
    });

    it('should handle real-world Paystack webhook format', () => {
      const webhookData = {
        event: 'charge.success',
        data: {
          id: 123456789,
          reference: 'ref123456',
          amount: 50000,
          currency: 'NGN',
          paid: true,
          status: 'success',
          customer: {
            id: 999,
            customer_code: 'CUS_xyz',
            email: 'customer@example.com',
          },
          metadata: {
            tenant_id: 'tenant-123',
            booking_id: 'booking-456',
          },
        },
      };

      const body = JSON.stringify(webhookData);
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      const result = verifyPaystackSignature(
        body,
        expectedSignature,
        paystackSecret
      );
      expect(result).toBe(true);
    });
  });

  describe('Cross-provider security', () => {
    it('should not verify Stripe signature with Paystack secret', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ test: 'data' });
      const signedContent = `${timestamp}.${body}`;

      const expectedSignature = crypto
        .createHmac('sha256', stripeSecret)
        .update(signedContent)
        .digest('hex');

      const headerSignature = `t=${timestamp},v1=${expectedSignature}`;

      // Try to verify Stripe signature with Paystack secret
      const result = verifyStripeSignature(
        body,
        headerSignature,
        paystackSecret
      );
      expect(result).toBe(false);
    });

    it('should not verify Paystack signature with Stripe secret', () => {
      const body = JSON.stringify({ test: 'data' });
      const expectedSignature = crypto
        .createHmac('sha512', paystackSecret)
        .update(body)
        .digest('hex');

      // Try to verify Paystack signature with Stripe secret
      const result = verifyPaystackSignature(
        body,
        expectedSignature,
        stripeSecret
      );
      expect(result).toBe(false);
    });
  });
});
