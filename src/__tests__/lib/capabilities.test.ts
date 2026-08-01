import {
  resolveCapabilities,
  capabilityForHref,
  isRouteEnabled,
  DEFAULT_CAPABILITIES,
} from '@/lib/capabilities';

describe('capabilities', () => {
  describe('resolveCapabilities', () => {
    it('defaults everything to on when blob is missing/empty', () => {
      expect(resolveCapabilities(undefined)).toEqual(DEFAULT_CAPABILITIES);
      expect(resolveCapabilities(null)).toEqual(DEFAULT_CAPABILITIES);
      expect(resolveCapabilities({})).toEqual(DEFAULT_CAPABILITIES);
    });

    it('respects explicit booleans and defaults the rest to on', () => {
      const caps = resolveCapabilities({ bookings: false });
      expect(caps.bookings).toBe(false);
      expect(caps.sales).toBe(true);
      expect(caps.crm).toBe(true);
    });

    it('forces inventory off when sales is off (dependency)', () => {
      const caps = resolveCapabilities({ sales: false, inventory: true });
      expect(caps.sales).toBe(false);
      expect(caps.inventory).toBe(false);
    });

    it('ignores non-boolean values', () => {
      const caps = resolveCapabilities({ bookings: 'yes', sales: 1 });
      expect(caps.bookings).toBe(true);
      expect(caps.sales).toBe(true);
    });
  });

  describe('capabilityForHref', () => {
    it('maps booking surfaces to bookings', () => {
      expect(capabilityForHref('/dashboard/bookings')).toBe('bookings');
      expect(capabilityForHref('/dashboard/owner/schedule')).toBe('bookings');
      expect(capabilityForHref('/dashboard/services')).toBe('bookings');
      expect(capabilityForHref('/dashboard/staff')).toBe('bookings');
    });

    it('maps commerce surfaces to sales, inventory sub-path to inventory', () => {
      expect(capabilityForHref('/dashboard/orders')).toBe('sales');
      expect(capabilityForHref('/dashboard/products')).toBe('sales');
      expect(capabilityForHref('/dashboard/showcase')).toBe('sales');
      expect(capabilityForHref('/dashboard/pos')).toBe('sales');
      // inventory is a sub-path of products — must resolve to inventory, not sales
      expect(capabilityForHref('/dashboard/products/inventory')).toBe('inventory');
    });

    it('maps crm + support surfaces', () => {
      expect(capabilityForHref('/dashboard/customers')).toBe('crm');
      expect(capabilityForHref('/dashboard/leads')).toBe('crm');
      expect(capabilityForHref('/dashboard/support')).toBe('support');
      expect(capabilityForHref('/dashboard/faqs')).toBe('support');
    });

    it('returns null for always-on surfaces', () => {
      for (const href of [
        '/dashboard',
        '/dashboard/chats',
        '/dashboard/tasks',
        '/dashboard/settings',
        '/dashboard/billing',
        '/dashboard/owner/analytics',
        '/dashboard/reports',
        '/dashboard/superadmin',
      ]) {
        expect(capabilityForHref(href)).toBeNull();
      }
    });
  });

  describe('isRouteEnabled', () => {
    const salesOnly = resolveCapabilities({ bookings: false, sales: true, inventory: true, crm: true, support: true });

    it('hides booking routes for a sales-only tenant but keeps commerce + always-on', () => {
      expect(isRouteEnabled('/dashboard/bookings', salesOnly)).toBe(false);
      expect(isRouteEnabled('/dashboard/owner/schedule', salesOnly)).toBe(false);
      expect(isRouteEnabled('/dashboard/services', salesOnly)).toBe(false);
      expect(isRouteEnabled('/dashboard/orders', salesOnly)).toBe(true);
      expect(isRouteEnabled('/dashboard/products/inventory', salesOnly)).toBe(true);
      expect(isRouteEnabled('/dashboard/chats', salesOnly)).toBe(true);
      expect(isRouteEnabled('/dashboard/settings', salesOnly)).toBe(true);
    });

    it('all-on default keeps every route enabled', () => {
      for (const href of [
        '/dashboard/bookings',
        '/dashboard/orders',
        '/dashboard/products/inventory',
        '/dashboard/customers',
        '/dashboard/support',
        '/dashboard/chats',
      ]) {
        expect(isRouteEnabled(href, DEFAULT_CAPABILITIES)).toBe(true);
      }
    });
  });
});
