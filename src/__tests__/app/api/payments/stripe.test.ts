import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/payments/stripe/route';

jest.mock('@/lib/webhooks/validation', () => ({
  verifyStripeSignature: jest.fn(),
}));

import { verifyStripeSignature } from '@/lib/webhooks/validation';

type MockSupabaseOptions = {
  duplicateEvent?: unknown;
  existingSuccessfulTransaction?: unknown;
  existingTransaction?: { tenant_id?: string } | null;
  insertError?: { message: string } | null;
  verifiedTenant?: { id: string } | null;
};

const createMockSupabase = (options: MockSupabaseOptions = {}) => {
  let currentTable = '';
  let eqFilters: Array<{ column: string; value: unknown }> = [];
  let filterCalls: Array<{ column: string; operator: string; value: unknown }> = [];

  const builder = {
    from: jest.fn((table: string) => {
      currentTable = table;
      eqFilters = [];
      filterCalls = [];
      return builder;
    }),
    select: jest.fn(() => builder),
    eq: jest.fn((column: string, value: unknown) => {
      eqFilters.push({ column, value });
      return builder;
    }),
    filter: jest.fn((column: string, operator: string, value: unknown) => {
      filterCalls.push({ column, operator, value });
      return builder;
    }),
    maybeSingle: jest.fn(async () => {
      if (currentTable === 'transactions') {
        if (filterCalls.some((call) => call.column === 'raw->>id')) {
          return { data: options.duplicateEvent ?? null, error: null };
        }

        if (
          eqFilters.some((filter) => filter.column === 'provider_reference') &&
          eqFilters.some((filter) => filter.column === 'status' && filter.value === 'success')
        ) {
          return { data: options.existingSuccessfulTransaction ?? null, error: null };
        }

        return { data: options.existingTransaction ?? null, error: null };
      }

      if (currentTable === 'tenants') {
        const tenantId = eqFilters.find((filter) => filter.column === 'id')?.value;
        if (options.verifiedTenant === null) {
          return { data: null, error: null };
        }

        return {
          data: options.verifiedTenant ?? (tenantId ? { id: String(tenantId) } : null),
          error: null,
        };
      }

      return { data: null, error: null };
    }),
    insert: jest.fn(async () => ({ error: options.insertError ?? null })),
    update: jest.fn(() => builder),
  };

  return builder;
};

const createRouteRequest = (url: string, init: RequestInit = {}): NextRequest => {
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';

  return {
    url,
    method: init.method ?? 'POST',
    headers,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
};

const createMockContext = (overrides: Record<string, unknown> = {}) => ({
  request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
    method: 'POST',
  }),
  supabase: createMockSupabase(),
  ...overrides,
});

const asRouteContext = (context: ReturnType<typeof createMockContext>) =>
  context as unknown as Parameters<typeof POST>[0];

const createStripeEvent = (type: string, amount: number, status: string, tenantId?: string) => ({
  id: 'evt_test_123',
  type,
  data: {
    object: {
      id: 'pi_test_123',
      amount: amount * 100,
      amount_received: amount * 100,
      currency: 'usd',
      status,
      metadata: tenantId ? { tenant_id: tenantId } : {},
    },
  },
});

const readRouteJson = async (response: Response | unknown) => {
  if (response instanceof Response) {
    return response.json();
  }

  if (response && typeof response === 'object' && 'json' in response && typeof (response as Response).json === 'function') {
    return (response as Response).json();
  }

  return response;
};

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
    it('returns an error when STRIPE_WEBHOOK_SECRET is not configured', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(asRouteContext(ctx));
      expect(await readRouteJson(response)).toMatchObject({ error: 'Webhook not configured' });
    });

    it('returns an error when STRIPE_WEBHOOK_SECRET is empty', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = '';

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(asRouteContext(ctx));
      expect(await readRouteJson(response)).toMatchObject({ error: 'Webhook not configured' });
    });
  });

  describe('Signature Verification', () => {
    it('verifies the stripe-signature header', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(false);

      const eventBody = JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded'));
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: {
            'stripe-signature': 't=1234567890,v1=test_signature',
            'content-type': 'application/json',
          },
          body: eventBody,
        }),
      });

      await POST(asRouteContext(ctx));

      expect(mockVerify).toHaveBeenCalledWith(
        eventBody,
        't=1234567890,v1=test_signature',
        'whsec_test_secret'
      );
    });

    it('rejects requests with an invalid signature', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(false);

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'invalid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
      });

      const response = await POST(asRouteContext(ctx));

      expect(await readRouteJson(response)).toMatchObject({
        error: 'Invalid signature',
        code: 'INVALID_SIGNATURE',
      });
    });

    it('accepts requests with a valid signature', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 't=1234567890,v1=valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: createMockSupabase(),
      });

      const response = await POST(asRouteContext(ctx));
      expect(await readRouteJson(response)).toEqual({ received: true });
    });
  });

  describe('JSON Parsing', () => {
    it('parses a valid JSON webhook body', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded');
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: createMockSupabase(),
      });

      const response = await POST(asRouteContext(ctx));
      expect(await readRouteJson(response)).toEqual({ received: true });
    });

    it('returns an error for invalid JSON', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: 'invalid json {',
        }),
      });

      const response = await POST(asRouteContext(ctx));
      expect(await readRouteJson(response)).toMatchObject({ error: 'Invalid JSON' });
    });
  });

  describe('Transaction Mapping', () => {
    it('maps payment_intent.succeeded into a transaction insert', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded', 'tenant-123');
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(asRouteContext(ctx));

      expect(mockSupabase.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          tenant_id: 'tenant-123',
          amount: 100,
          currency: 'usd',
          type: 'payment_intent.succeeded',
          status: 'succeeded',
          raw: event,
        }),
      ]);
    });

    it('uses amount_received before amount when available', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const event = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            amount: 10000,
            amount_received: 9500,
            currency: 'usd',
            status: 'succeeded',
            metadata: {},
          },
        },
      };

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(asRouteContext(ctx));

      expect(mockSupabase.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          amount: 95,
        }),
      ]);
    });

    it('leaves tenant_id null when metadata cannot be verified', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase({ verifiedTenant: null });
      const event = createStripeEvent('payment_intent.succeeded', 100, 'succeeded', 'tenant-123');
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(asRouteContext(ctx));

      expect(mockSupabase.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          tenant_id: null,
        }),
      ]);
    });
  });

  describe('Event Handling', () => {
    it('short-circuits duplicate events', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase({ duplicateEvent: { id: 'tx_1' } });
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(asRouteContext(ctx));

      expect(mockSupabase.insert).not.toHaveBeenCalled();
      expect(await readRouteJson(response)).toEqual({ received: true });
    });

    it('records payment_intent.failed events', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const event = createStripeEvent('payment_intent.failed', 100, 'failed');
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(event),
        }),
        supabase: mockSupabase,
      });

      await POST(asRouteContext(ctx));

      expect(mockSupabase.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'payment_intent.failed',
          status: 'failed',
        }),
      ]);
    });
  });

  describe('Database Operations', () => {
    it('writes to the transactions table', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase();
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      await POST(asRouteContext(ctx));

      expect(mockSupabase.from).toHaveBeenCalledWith('transactions');
    });

    it('returns a database error response when insert fails', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const mockSupabase = createMockSupabase({
        insertError: { message: 'Database error' },
      });
      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: mockSupabase,
      });

      const response = await POST(asRouteContext(ctx));

      expect(await readRouteJson(response)).toMatchObject({
        error: 'database_error',
      });
    });
  });

  describe('Response Format', () => {
    it('returns { received: true } on success', async () => {
      const mockVerify = verifyStripeSignature as jest.MockedFunction<typeof verifyStripeSignature>;
      mockVerify.mockReturnValue(true);

      const ctx = createMockContext({
        request: createRouteRequest('http://localhost:3000/api/payments/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 'valid_signature' },
          body: JSON.stringify(createStripeEvent('payment_intent.succeeded', 100, 'succeeded')),
        }),
        supabase: createMockSupabase(),
      });

      const response = await POST(asRouteContext(ctx));
      expect(await readRouteJson(response)).toEqual({ received: true });
    });
  });
});
