import { describe, expect, it } from '@jest/globals';
import { buildFrontDeskPrompt } from '@/lib/ai/context-builder';
import type { GroundingResult } from '@/lib/ai/grounding-service';

function makeGrounding(overrides: Partial<GroundingResult> = {}): GroundingResult {
  return {
    route: { intent: 'sales_inquiry', confidence: 'high', source: 'rules' },
    tenant: {
      id: 'tenant-1',
      name: 'Test Salon',
      settings: { staff_title: 'stylist', booking_noun: 'appointment' },
      buffer_minutes: 15,
      timezone: 'Africa/Lagos',
    },
    services: [
      { id: 'svc-1', name: 'Braids', price_cents: 25000, duration_minutes: 90 },
    ],
    staff: [
      { id: 'staff-1', name: 'Ada', phone: '+2348000000000' },
    ],
    products: [
      { id: 'prd-1', name: 'Hair Growth Oil', price_cents: 12000, stock_quantity: 5, track_inventory: true, description: 'Best for dry scalp' },
    ],
    showcasePacks: [
      { id: 'pack-1', name: 'Retail Catalog', template_kind: 'catalog', description: 'Featured products' },
    ],
    customerRecall: {
      customerId: 'cust-1',
      customerName: 'Amaka',
      customerPhone: '+2348000000001',
      lastService: 'Knotless Braids',
      usualStaff: 'Ada',
      lastVisitAt: '2026-06-01T10:00:00.000Z',
      visitCount: 4,
      rebookingDue: true,
    },
    availableSlots: [],
    bookings: [],
    ownerSummary: null,
    timezone: 'Africa/Lagos',
    dateRange: { start: '2026-06-26', end: '2026-06-26', label: 'today' },
    ...overrides,
  };
}

describe('buildFrontDeskPrompt', () => {
  it('renders returning-customer recall and sales grounding blocks', () => {
    const prompt = buildFrontDeskPrompt({
      grounding: makeGrounding(),
      message: 'What products do you have and can I get my usual?',
      conv: {
        id: 'conv-1',
        tenant_id: 'tenant-1',
        phone_number: '+2348000000001',
        external_id: '+2348000000001',
        channel: 'whatsapp',
        role: 'customer',
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
        last_inbound_at: null,
        opted_out_at: null,
      },
      userRole: 'customer',
    });

    expect(prompt).toContain('Returning customer context:');
    expect(prompt).toContain('Their last recorded service was Knotless Braids.');
    expect(prompt).toContain('They often book with Ada.');
    expect(prompt).toContain('They may be due for a rebook based on their last service interval.');
    expect(prompt).toContain('confirm what they actually want before assuming details');
    expect(prompt).toContain('Products / retail context:');
    expect(prompt).toContain('Hair Growth Oil [id=prd-1]');
    expect(prompt).toContain('Showcase / portfolio context:');
    expect(prompt).toContain('Retail Catalog [id=pack-1]');
    expect(prompt).toContain('show_catalog');
    expect(prompt).toContain('show_showcase');
    expect(prompt).toContain('recommend_products');
    expect(prompt).toContain('create_retail_payment_link');
    expect(prompt).toContain('Retail order:');
    expect(prompt).toContain('Use "show_showcase" when the customer explicitly wants a portfolio');
  });

  it('omits the returning-customer block when no recall is present', () => {
    const prompt = buildFrontDeskPrompt({
      grounding: makeGrounding({ customerRecall: null }),
      message: 'Do you have products?',
      conv: {
        id: 'conv-1',
        tenant_id: 'tenant-1',
        phone_number: '+2348000000001',
        external_id: '+2348000000001',
        channel: 'whatsapp',
        role: 'customer',
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
        last_inbound_at: null,
        opted_out_at: null,
      },
      userRole: 'customer',
    });

    expect(prompt).not.toContain('Returning customer context:');
  });
});
