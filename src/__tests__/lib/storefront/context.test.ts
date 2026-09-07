import { describe, expect, it } from '@jest/globals';
import { consumeStorefrontContextMarker, createStorefrontContextToken } from '@/lib/storefront/context';

describe('storefront AI context handoff', () => {
  it('verifies and strips a signed storefront marker', () => {
    const token = createStorefrontContextToken({ tenantId: 'tenant-a', pageType: 'service', serviceId: 'service-a' });
    const result = consumeStorefrontContextMarker(`Can I book tomorrow? #booka:${token}`, 'tenant-a');
    expect(result.message).toBe('Can I book tomorrow?');
    expect(result.context).toMatchObject({ tenantId: 'tenant-a', pageType: 'service', serviceId: 'service-a' });
  });
  it('never accepts a marker from another tenant', () => {
    const token = createStorefrontContextToken({ tenantId: 'tenant-a', pageType: 'product' });
    expect(consumeStorefrontContextMarker(`#booka:${token}`, 'tenant-b').context).toBeNull();
  });
});
