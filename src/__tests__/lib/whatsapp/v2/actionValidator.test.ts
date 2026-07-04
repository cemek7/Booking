/**
 * Tests for validateWalkIn (exercised via validateAction)
 *
 * validateWalkIn resolves staff/service identifiers, checks for scheduling
 * conflicts, and mutates params with resolved IDs before returning.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Supabase mock ──────────────────────────────────────────────────────────
// Each DB call shifts the next response off the queue in the order it was pushed.

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: unknown; error: null }> = [];

function pushDb(data: unknown) {
  responses.push({ data, error: null });
}

function makeChain() {
  const chain: Record<string, unknown> = {};
  const filters = ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order'];
  filters.forEach(m => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });
  (chain as any).maybeSingle = jest.fn().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? { data: null, error: null })
  );
  (chain as any).limit = jest.fn().mockImplementation(() =>
    Promise.resolve(responses.shift() ?? { data: null, error: null })
  );
  (chain as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
  (chain as any).upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  (chain as any).update = jest.fn().mockReturnValue(chain);
  return chain;
}

const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockClient),
}));

jest.mock('@/lib/booking/engine', () => ({
  bookingEngine: { createBooking: jest.fn() },
}));

const mockSendShowcasePack = jest.fn();
jest.mock('@/lib/whatsapp/showcasePackService', () => ({
  sendShowcasePack: mockSendShowcasePack,
}));

const mockSendInteractiveMessage = jest.fn();
const mockSendMediaMessage = jest.fn();
const mockGetTenantWhatsAppProviderClient = jest.fn();
jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClient: mockGetTenantWhatsAppProviderClient,
}));

jest.mock('@/lib/ai/front-desk-events', () => ({
  recordFrontDeskEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/ai/front-desk-sales', () => ({
  upsertLeadRecord: jest.fn().mockResolvedValue({ id: 'lead-1', status: 'qualified' }),
  scheduleLeadRecoveryCampaign: jest.fn().mockResolvedValue('campaign-1'),
}));

const mockCreateRetailOrderPaymentLinkForCustomer = jest.fn();
jest.mock('@/lib/commerce/retail-orders', () => ({
  createRetailOrderPaymentLinkForCustomer: mockCreateRetailOrderPaymentLinkForCustomer,
}));

import { executeAction, validateAction } from '@/lib/whatsapp/v2/actionValidator';
import type { AIResponse } from '@/lib/whatsapp/v2/actionValidator';

// ── Helpers ────────────────────────────────────────────────────────────────

const TENANT = 'tenant_test_abc';

function walkIn(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'walk_in', params, reply: 'Walk-in recorded', confidence: 'high' };
}

function showCatalog(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'show_catalog', params, reply: 'Here are a few products you can choose from.', confidence: 'high' };
}

function showShowcase(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'show_showcase', params, reply: 'Sending our showcase now.', confidence: 'high' };
}

function recommendProducts(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'recommend_products', params, reply: 'Here are the products I recommend.', confidence: 'high' };
}

function sendQuote(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'send_quote', params, reply: 'Here is the quote I prepared.', confidence: 'high' };
}

function qualifyLead(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'qualify_lead', params, reply: 'Let me understand what you need first.', confidence: 'high' };
}

function createRetailPaymentLink(params: Record<string, unknown> = {}): AIResponse {
  return { action: 'create_retail_payment_link', params, reply: 'I can send your payment link now.', confidence: 'high' };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('validateAction — walk_in', () => {
  beforeEach(() => {
    responses.length = 0;
    jest.clearAllMocks();
  });

  it('returns invalid immediately when no staff identifier is provided', async () => {
    const result = await validateAction(TENANT, walkIn({}));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/staff identifier/i);
    // No DB queries needed
    expect(mockClient.from).not.toHaveBeenCalledWith('tenant_users');
  });

  it('returns invalid when staff_name lookup finds no matching staff', async () => {
    pushDb(null); // tenant_users → not found

    const result = await validateAction(TENANT, walkIn({ staff_name: 'Ada' }));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/staff identifier/i);
    expect(result.retryContext).toMatch(/staff member/i);
  });

  it('returns invalid with conflict details when staff has an active booking', async () => {
    // tenant_staff_id provided directly — no staff lookup
    // service_id provided directly — fetch duration
    pushDb({ duration: 45 }); // services

    // Conflict found
    const conflictEndAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    pushDb({ start_at: new Date().toISOString(), end_at: conflictEndAt, customer_number: 'Chisom' }); // reservations

    const result = await validateAction(TENANT, walkIn({
      tenant_staff_id: 'staff_1',
      service_id: 'svc_1',
    }));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/active booking/i);
    expect(result.retryContext).toMatch(/Chisom/);
  });

  it('returns valid and mutates params when no conflict (pre-resolved IDs)', async () => {
    pushDb({ duration: 30 }); // services duration
    pushDb(null); // reservations conflict → none

    const params: Record<string, unknown> = { tenant_staff_id: 'staff_1', service_id: 'svc_1' };
    const result = await validateAction(TENANT, walkIn(params));

    expect(result.valid).toBe(true);
    expect(params.resolved_staff_id).toBe('staff_1');
    expect(params.resolved_service_id).toBe('svc_1');
    expect(typeof params.walk_in_start_at).toBe('string');
    expect(typeof params.walk_in_end_at).toBe('string');
    // Duration should be ~30 minutes
    const durationMs =
      new Date(params.walk_in_end_at as string).getTime() -
      new Date(params.walk_in_start_at as string).getTime();
    expect(durationMs).toBeGreaterThanOrEqual(29 * 60 * 1000);
    expect(durationMs).toBeLessThanOrEqual(31 * 60 * 1000);
  });

  it('resolves staff and service by name and returns valid', async () => {
    pushDb({ id: 'staff_resolved' }); // tenant_users
    pushDb({ id: 'svc_resolved', duration: 60 }); // services
    pushDb(null); // conflict → none

    const params: Record<string, unknown> = { staff_name: 'Ada', service_name: 'Trim' };
    const result = await validateAction(TENANT, walkIn(params));

    expect(result.valid).toBe(true);
    expect(params.resolved_staff_id).toBe('staff_resolved');
    expect(params.resolved_service_id).toBe('svc_resolved');
  });

  it('defaults to 60-minute duration when service has no entry', async () => {
    pushDb({ id: 'staff_1' }); // tenant_users — staff found by name
    // No service_name, no service_id → skip service lookup, default 60 min
    pushDb(null); // reservations conflict → none

    const params: Record<string, unknown> = { staff_name: 'Ada' };
    await validateAction(TENANT, walkIn(params));

    const durationMs =
      new Date(params.walk_in_end_at as string).getTime() -
      new Date(params.walk_in_start_at as string).getTime();
    expect(durationMs).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(durationMs).toBeLessThanOrEqual(61 * 60 * 1000);
  });
});

describe('executeAction — sales actions', () => {
  beforeEach(() => {
    responses.length = 0;
    jest.clearAllMocks();
    mockGetTenantWhatsAppProviderClient.mockResolvedValue({
      sendInteractiveMessage: mockSendInteractiveMessage,
      sendMediaMessage: mockSendMediaMessage,
    });
    mockCreateRetailOrderPaymentLinkForCustomer.mockResolvedValue({
      orderId: 'ord-1',
      reference: 'ref-1',
      paymentUrl: 'https://pay.example.com/retail/ref-1',
      totalCents: 185000,
    });
    mockSendInteractiveMessage.mockResolvedValue({ success: true, messageId: 'msg-1' });
    mockSendMediaMessage.mockResolvedValue({ success: true, messageId: 'media-1' });
  });

  it('sends a showcase pack through the showcase service', async () => {
    mockSendShowcasePack.mockResolvedValueOnce({ success: true, sentCount: 3, pack: { id: 'pack-1' } });

    const result = await executeAction(TENANT, showShowcase({ showcase_id: 'pack-1' }), {
      customerPhone: '+2348000000000',
    });

    expect(result.success).toBe(true);
    expect(mockSendShowcasePack).toHaveBeenCalledWith(
      TENANT,
      '+2348000000000',
      'pack-1',
      undefined,
    );
  });

  it('returns matching catalog products for show_catalog', async () => {
    pushDb([
      {
        id: 'prd-1',
        name: 'Hair Growth Oil',
        short_description: 'Best for dry scalp',
        category: 'hair care',
        price_cents: 12000,
        currency: 'NGN',
        is_featured: true,
        stock_quantity: 5,
        track_inventory: true,
      },
      {
        id: 'prd-2',
        name: 'Edge Control',
        short_description: 'Strong hold',
        category: 'styling',
        price_cents: 6500,
        currency: 'NGN',
        is_featured: false,
        stock_quantity: 9,
        track_inventory: true,
      },
    ]);

    const result = await executeAction(TENANT, showCatalog({ query: 'growth oil' }), {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'catalog',
      title: 'Catalog results for "growth oil"',
    });
    expect((result.data as { products: Array<{ id: string }> }).products).toHaveLength(1);
    expect((result.data as { products: Array<{ id: string }> }).products[0]?.id).toBe('prd-1');
  });

  it('uses interactive product details for a single meta-backed catalog result', async () => {
    pushDb([
      {
        id: 'prd-1',
        name: 'Hair Growth Oil',
        short_description: 'Best for dry scalp',
        category: 'hair care',
        price_cents: 12000,
        currency: 'NGN',
        is_featured: true,
        stock_quantity: 5,
        track_inventory: true,
      },
    ]);

    const result = await executeAction(TENANT, showCatalog({ query: 'growth oil' }), {
      customerPhone: '+2348000000000',
    });

    expect(result.success).toBe(true);
    expect((result.data as { delivery: string }).delivery).toBe('interactive');
    expect(mockSendInteractiveMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.objectContaining({ type: 'button' }),
    );
  });

  it('returns related products for recommend_products', async () => {
    pushDb([
      {
        id: 'prd-1',
        name: 'Hair Growth Oil',
        short_description: 'Best for dry scalp',
        category: 'hair care',
        price_cents: 12000,
        currency: 'NGN',
        is_featured: true,
        stock_quantity: 5,
        track_inventory: true,
      },
      {
        id: 'prd-2',
        name: 'Scalp Serum',
        short_description: 'Supports healthy growth',
        category: 'hair care',
        price_cents: 15000,
        currency: 'NGN',
        is_featured: false,
        stock_quantity: 6,
        track_inventory: true,
      },
      {
        id: 'prd-3',
        name: 'Edge Control',
        short_description: 'Strong hold',
        category: 'styling',
        price_cents: 6500,
        currency: 'NGN',
        is_featured: true,
        stock_quantity: 9,
        track_inventory: true,
      },
    ]);

    const result = await executeAction(TENANT, recommendProducts({ product_ids: ['prd-1'] }), {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'recommendations',
      title: 'Recommended products',
    });
    expect((result.data as { products: Array<{ id: string }> }).products).toHaveLength(1);
    expect((result.data as { products: Array<{ id: string }> }).products[0]?.id).toBe('prd-2');
  });

  it('uses interactive recommendation sending when meta-backed delivery is available', async () => {
    pushDb([
      {
        id: 'prd-1',
        name: 'Hair Growth Oil',
        short_description: 'Best for dry scalp',
        category: 'hair care',
        price_cents: 12000,
        currency: 'NGN',
        is_featured: true,
        stock_quantity: 5,
        track_inventory: true,
      },
      {
        id: 'prd-2',
        name: 'Scalp Serum',
        short_description: 'Supports healthy growth',
        category: 'hair care',
        price_cents: 15000,
        currency: 'NGN',
        is_featured: false,
        stock_quantity: 6,
        track_inventory: true,
      },
    ]);

    const result = await executeAction(TENANT, recommendProducts({ product_ids: ['prd-1'] }), {
      customerPhone: '+2348000000000',
    });

    expect(result.success).toBe(true);
    expect((result.data as { delivery: string }).delivery).toBe('interactive');
    expect(mockSendInteractiveMessage).toHaveBeenCalledWith(
      '+2348000000000',
      expect.objectContaining({ type: 'list' }),
    );
  });

  it('builds a service quote for consultative selling', async () => {
    pushDb({
      id: 'svc-1',
      name: 'Signature Braids',
      price: 25000,
      duration: 180,
    });

    const result = await executeAction(TENANT, sendQuote({ service_name: 'Braids' }), {
      customerPhone: '+2348000000000',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      quote: {
        id: 'svc-1',
        name: 'Signature Braids',
        price: 25000,
        duration: 180,
      },
    });
  });

  it('qualifies a lead without breaking the action path', async () => {
    const result = await executeAction(TENANT, qualifyLead({
      desired_outcome: 'knotless braids',
      budget: '25000',
      preferred_timing: 'next weekend',
    }), {
      customerPhone: '+2348000000000',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      stage: 'qualified',
      lead: { id: 'lead-1' },
    });
  });

  it('creates a retail payment link for an existing draft order', async () => {
    const result = await executeAction(TENANT, createRetailPaymentLink(), {
      customerPhone: '+2348000000000',
      channel: 'whatsapp',
      messageId: 'msg-22',
    });

    expect(result.success).toBe(true);
    expect(mockCreateRetailOrderPaymentLinkForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        externalId: '+2348000000000',
      }),
    );
    expect(result.data).toMatchObject({
      orderId: 'ord-1',
      reference: 'ref-1',
      paymentUrl: 'https://pay.example.com/retail/ref-1',
    });
  });
});
