import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/intentDetector', () => ({
  detectIntent: jest.fn(),
}));

import { detectIntent } from '@/lib/intentDetector';
import { routeIntent } from '@/lib/ai/intent-router';

describe('routeIntent', () => {
  it('classifies product and showcase questions as sales inquiries via rules', async () => {
    const result = await routeIntent('Can I see your product catalog and showcase packs?', {
      userRole: 'customer',
    });

    expect(result).toEqual({
      intent: 'sales_inquiry',
      confidence: 'high',
      source: 'rules',
    });
  });

  it('maps product_inquiry from the fallback detector into sales_inquiry', async () => {
    jest.mocked(detectIntent).mockResolvedValueOnce({
      intent: 'product_inquiry',
      confidence: 0.84,
      entities: [],
      fallbackUsed: false,
    });

    const result = await routeIntent('Need some suggestions for what I can get today', {
      userRole: 'customer',
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({
      intent: 'sales_inquiry',
      confidence: 'high',
      source: 'llm_fallback',
    });
  });
});
