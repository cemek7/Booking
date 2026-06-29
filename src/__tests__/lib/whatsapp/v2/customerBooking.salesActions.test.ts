import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockExecuteAction = jest.fn();

jest.mock('@/lib/booking/action-validator', () => ({
  executeAction: mockExecuteAction,
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(),
  })),
}));

jest.mock('@/lib/paymentService', () => jest.fn());
jest.mock('@/lib/reservationService', () => ({
  createReservation: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  updateConversation: jest.fn(),
  resetConversation: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/slotEngine', () => ({
  getAvailableSlots: jest.fn(),
  lockSlot: jest.fn(),
  releaseLock: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/waitlist', () => ({
  addToWaitlist: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
  defaultLogger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockRecordAttribution = jest.fn();
const mockRecordEvent = jest.fn();
jest.mock('@/lib/sias-operations', () => ({
  siasOperations: { recordOutcomeAttribution: (...args: unknown[]) => mockRecordAttribution(...args) },
}));
jest.mock('@/lib/ai/front-desk-events', () => ({
  recordFrontDeskEvent: (...args: unknown[]) => mockRecordEvent(...args),
}));

import { handleCustomerBooking } from '@/lib/whatsapp/v2/flows/customerBooking';
import { updateConversation } from '@/lib/whatsapp/v2/conversationState';

function makeConv() {
  return {
    id: 'conv-1',
    tenant_id: 'tenant-1',
    phone_number: '+2348000000000',
    external_id: '+2348000000000',
    channel: 'whatsapp' as const,
    role: 'customer' as const,
    current_flow: 'idle',
    flow_step: 0,
    flow_data: {},
    last_inbound_at: null,
    opted_out_at: null,
  };
}

describe('handleCustomerBooking sales actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecordAttribution.mockResolvedValue(undefined);
    mockRecordEvent.mockResolvedValue(undefined);
  });

  it('formats catalog results into a customer reply', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: {
        title: 'Hair care catalog',
        products: [
          {
            id: 'prd-1',
            name: 'Hair Growth Oil',
            price_cents: 12000,
            stock_quantity: 5,
            track_inventory: true,
            description: 'Best for dry scalp',
          },
        ],
      },
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'show_catalog',
        params: { category: 'hair care' },
        reply: 'Here are a few products you can choose from.',
        confidence: 'high',
      },
      makeConv(),
      'show me products',
    );

    expect(reply).toContain('Here are a few products you can choose from.');
    expect(reply).toContain('*Hair care catalog*');
    expect(reply).toContain('*Hair Growth Oil*');
    expect(reply).toContain('₦120');
  });

  it('returns an empty string when interactive catalog delivery succeeds', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: {
        delivery: 'interactive',
        title: 'Hair care catalog',
        products: [
          { id: 'prd-1', name: 'Hair Growth Oil' },
        ],
      },
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'show_catalog',
        params: { category: 'hair care' },
        reply: 'Here are a few products you can choose from.',
        confidence: 'high',
      },
      makeConv(),
      'show me products',
    );

    expect(reply).toBe('');
  });

  it('returns an empty string when showcase send succeeds to avoid duplicate text', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: { sentCount: 3 },
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'show_showcase',
        params: { showcase_id: 'pack-1' },
        reply: 'Sending our showcase now.',
        confidence: 'high',
      },
      makeConv(),
      'show me your work',
    );

    expect(reply).toBe('');
    expect(mockExecuteAction).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ action: 'show_showcase' }),
      { customerPhone: '+2348000000000', channel: 'whatsapp', userRole: 'customer' },
    );
  });

  it('returns a clear fallback when recommendations fail', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: false,
      error: 'No suitable product recommendations found',
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'recommend_products',
        params: { reason: 'braid aftercare' },
        reply: 'Here are the products I recommend.',
        confidence: 'high',
      },
      makeConv(),
      'what should i use after braids?',
    );

    expect(reply).toContain('I couldn\'t pull product recommendations right now');
  });

  it('returns an empty string when interactive recommendations succeed', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: {
        delivery: 'interactive',
        title: 'Recommended products',
        products: [
          { id: 'prd-2', name: 'Scalp Serum' },
        ],
      },
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'recommend_products',
        params: { reason: 'braid aftercare' },
        reply: 'Here are the products I recommend.',
        confidence: 'high',
      },
      makeConv(),
      'what should i use after braids?',
    );

    expect(reply).toBe('');
  });

  it('formats a consultative quote reply', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: {
        quote: {
          name: 'Signature Braids',
          price: 25000,
          duration: 180,
        },
      },
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'send_quote',
        params: { service_name: 'Braids' },
        reply: 'Based on what you described, this is the best fit.',
        confidence: 'high',
      },
      makeConv(),
      'how much for braids?',
    );

    expect(reply).toContain('Based on what you described');
    expect(reply).toContain('Signature Braids');
    expect(reply).toContain('₦25,000');
    expect(reply).toContain('180 minutes');
  });

  it('returns the lead qualification prompt reply while persisting sales state', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: { stage: 'qualified', lead: { id: 'lead-1' } },
    });

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'qualify_lead',
        params: { desired_outcome: 'soft glam', budget: '15000' },
        reply: 'To recommend the best option, what look are you going for and what budget should I work with?',
        confidence: 'high',
      },
      makeConv(),
      'i need makeup for an event',
    );

    expect(reply).toContain('what look are you going for');
  });

  it('persists a pending_upsell when an upsell offer is sent', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      success: true,
      data: {
        mode: 'upsell',
        title: 'Recommended add-ons',
        products: [
          { id: 'prd-7', name: 'Argan Hair Oil', price_cents: 650000 },
          { id: 'prd-8', name: 'Heat Protectant', price_cents: 390000 },
        ],
      },
    });

    await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      {
        action: 'offer_upsell',
        params: { reason: 'aftercare' },
        reply: 'Want to keep that style fresh? I’d add these.',
        confidence: 'high',
      },
      makeConv(),
      'yes recommend add-ons',
    );

    expect(updateConversation).toHaveBeenCalledWith(
      '+2348000000000',
      'tenant-1',
      expect.objectContaining({
        flow_data: expect.objectContaining({
          pending_upsell: expect.objectContaining({
            mode: 'upsell',
            product_ids: ['prd-7', 'prd-8'],
            total_cents: 1040000,
          }),
        }),
      }),
      'whatsapp',
    );
  });

  it('records an upsell conversion when the customer affirms a pending offer', async () => {
    const conv = makeConv();
    conv.flow_data = {
      pending_upsell: { mode: 'upsell', product_ids: ['prd-7'], total_cents: 650000, offered_at: '2026-06-29T00:00:00Z' },
    };

    const reply = await handleCustomerBooking(
      '+2348000000000',
      'tenant-1',
      { action: 'affirm' },
      conv,
      'yes please',
    );

    expect(mockRecordAttribution).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        customerPhone: '+2348000000000',
        signal: 'upsell_conversion',
        value: 6500,
        metadata: expect.objectContaining({ product_ids: ['prd-7'], mode: 'upsell' }),
      }),
    );
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'upsell_accepted', eventCategory: 'sales' }),
    );
    // pending_upsell cleared
    expect(updateConversation).toHaveBeenCalledWith(
      '+2348000000000',
      'tenant-1',
      expect.objectContaining({ flow_data: expect.objectContaining({ pending_upsell: null }) }),
      'whatsapp',
    );
    expect(reply).toContain('Great choice');
  });
});
