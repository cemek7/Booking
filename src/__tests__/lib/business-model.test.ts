import { describe, expect, it } from '@jest/globals';
import { capabilitiesForCommercialMotion, commercialMotionFromSettings, primaryActionForCommercialMotion, resolveCommercialMotion } from '@/lib/business-model';

describe('commercial motion', () => {
  it('keeps hybrid sales enabled before the first product is added', () => {
    expect(capabilitiesForCommercialMotion('hybrid')).toMatchObject({ bookings: true, sales: true, inventory: false, crm: true, support: true });
  });

  it('sets coherent workflow floors for sales and enquiry businesses', () => {
    expect(capabilitiesForCommercialMotion('sales', { hasInventory: true })).toMatchObject({ bookings: false, sales: true, inventory: true });
    expect(capabilitiesForCommercialMotion('enquiry')).toMatchObject({ bookings: false, sales: false, inventory: false, crm: true, support: true });
  });

  it('uses safe defaults for missing persisted data', () => {
    expect(resolveCommercialMotion('unexpected')).toBe('hybrid');
    expect(commercialMotionFromSettings(undefined, { bookings: false, sales: true })).toBe('sales');
    expect(primaryActionForCommercialMotion('sales')).toEqual({ label: 'Shop now', kind: 'shop' });
    expect(primaryActionForCommercialMotion('enquiry')).toEqual({ label: 'Ask Booka', kind: 'ask' });
  });
});
