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

import { handleCustomerBooking } from '@/lib/whatsapp/v2/flows/customerBooking';

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
      { customerPhone: '+2348000000000' },
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
});
