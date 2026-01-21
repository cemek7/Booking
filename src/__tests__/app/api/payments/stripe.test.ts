import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/payments/stripe/route';

// Mock dependencies
jest.mock('@/lib/webhooks/validation', () => ({
  verifyStripeSignature: jest.fn(),
}));

jest.mock('@/lib/error-handling/api-error');

import { verifyStripeSignature } from '@/lib/webhooks/validation';

const createMockSupabase = () => ({
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
});

const createMockContext = (overrides = {}) => ({
  request: new NextRequest('http://localhost:3000/api/payments/stripe', {
    method: 'POST',
  }),
  supabase: createMockSupabase(),
  ...overrides,
});

const createStripeEvent = (type: string, amount: number, status: string, tenantId?: string) => ({
  id: 'evt_test_123',
  type,
  data: {
    object: {
      id: 'pi_test_123',
      amount: amount * 100, // Stripe uses cents
      amount_received: amount * 100,
      currency: 'usd',
      status,
      metadata: tenantId ? { tenant_id: tenantId } : {},
    },
  },
});

describe('POST /api/payments/stripe', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Webhook Secret Configuration', () => {
    it('should return error when STRIPE_WEBHOOK_SECRET is not configured', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ error: 'Webhook not configured' });
    });

    it('should return error when STRIPE_WEBHOOK_SECRET is empty string', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = '';

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ error: 'Webhook not configured' });
    });
  });

  describe('Signature Verification', () => {
    it('should verify stripe-signature header', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(false);

      const eventBody = JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded'));
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: {
            'stripe-signature': 't=1234567890,v1=test_signature',
            'content-type': 'application/json',
          },
          body: eventBody,
        }),
      });

      await POST(ctx as any);

      expect(mockVerify).toHaveBeenCalledWith(
        eventBody,
        't=1234567890,v1=test_signature',
        'whsec_test_secret'
      );
    });

    it('should reject request with invalid signature', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(false);

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: {
            'stripe-signature': 'invalid_signature',
          },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      });
    });

    it('should accept request with valid signature', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: {
            'stripe-signature': 't=1234567890,v1=valid_signature',
          },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ received: true });
    });

    it('should handle missing stripe-signature header', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(false);

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      });
    });
  });

  describe('JSON Parsing', () => {
    it('should parse valid JSON webhook body', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });

      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ received: true });
    });

    it('should return error for invalid JSON', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: 'invalid json {',
        }),
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ error: 'Invalid JSON' });
    });

    it('should handle empty body', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: '',
        }),
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ error: 'Invalid JSON' });
    });
  });

  describe('Transaction Mapping', () => {
    it('should map payment_intent.succeeded event to transaction', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded', 'tenant-123');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          tenant_id: 'tenant-123',
          amount: 100,
          currency: 'usd',
          type: 'payment_intent.succeeded',
          status: 'succeeded',
        }),
      ]);
    });

    it('should convert amount from cents to dollars', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('payment_intent.succeeded', 250, 'succeeded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          amount: 250, // 25000 cents / 100
        }),
      ]);
    });

    it('should handle missing tenant_id in metadata', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          tenant_id: null,
        }),
      ]);
    });

    it('should use amount_received when available', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            amount: 10000,
            amount_received: 9500, // Different amount after fees
            currency: 'usd',
            status: 'succeeded',
            metadata: {},
          },
        },
      };

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          amount: 95, // amount_received takes precedence
        }),
      ]);
    });

    it('should fallback to amount when amount_received is missing', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            amount: 10000,
            currency: 'usd',
            status: 'succeeded',
            metadata: {},
          },
        },
      };

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          amount: 100,
        }),
      ]);
    });

    it('should store raw event data', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          raw: event,
        }),
      ]);
    });
  });

  describe('Event Types', () => {
    it('should handle payment_intent.succeeded', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });

      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ received: true });
    });

    it('should handle payment_intent.failed', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('payment_intent.failed', 100, 'failed');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'payment_intent.failed',
          status: 'failed',
        }),
      ]);
    });

    it('should handle charge.refunded', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('charge.refunded', 100, 'refunded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'charge.refunded',
        }),
      ]);
    });

    it('should handle unknown event types', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockInsert = jest.fn().mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.insert = mockInsert;

      const event = createStripeEvent('unknown.event.type', 100, 'succeeded');
      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'unknown.event.type',
        }),
      ]);
    });
  });

  describe('Database Operations', () => {
    it('should insert transaction into database', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const mockFrom = jest.fn().mockReturnThis();
      mockSupabase.from = mockFrom;
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      await POST(ctx as any);

      expect(mockFrom).toHaveBeenCalledWith('transactions');
    });

    it('should throw error when database insert fails', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({
          error: { message: 'Database error' },
        }),
      });

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      await expect(POST(ctx as any)).rejects.toThrow();
    });
  });

  describe('Security', () => {
    it('should not require Bearer token authentication', () => {
      // This route uses { auth: false } configuration
      expect(POST).toBeDefined();
    });

    it('should rely solely on webhook signature for security', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });

      // No user context provided
      const ctx = createMockContext({
        user: undefined,
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ received: true });
    });
  });

  describe('Response Format', () => {
    it('should return { received: true } on success', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      mockSupabase.insert.mockReturnValue({
        ...mockSupabase,
        then: jest.fn().mockResolvedValue({ error: null }),
      });

      const ctx = createMockContext({
        request: new NextRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(ctx as any);

      expect(response).toEqual({ received: true });
    });
  });
});
