import type { TenantCapabilities } from '@/lib/capabilities';

/** The way a business converts customer conversations into revenue. */
export const COMMERCIAL_MOTIONS = ['booking', 'sales', 'hybrid', 'enquiry'] as const;
export type CommercialMotion = (typeof COMMERCIAL_MOTIONS)[number];

export const COMMERCIAL_MOTION_DETAILS: Record<CommercialMotion, { label: string; description: string }> = {
  hybrid: { label: 'Bookings and sales', description: 'Take appointments or reservations and sell products.' },
  booking: { label: 'Bookings or reservations', description: 'Customers primarily choose a time, service, room, or table.' },
  sales: { label: 'Products and orders', description: 'Customers primarily browse, buy, and arrange fulfilment.' },
  enquiry: { label: 'Enquiries and quotes', description: 'Customers need advice, a quote, or a consultation before buying.' },
};

export function resolveCommercialMotion(value: unknown): CommercialMotion {
  return typeof value === 'string' && (COMMERCIAL_MOTIONS as readonly string[]).includes(value) ? value as CommercialMotion : 'hybrid';
}

/** Backward-compatible inference for tenants created before commercialMotion. */
export function commercialMotionFromSettings(value: unknown, capabilities: Pick<TenantCapabilities, 'bookings' | 'sales'>): CommercialMotion {
  if (typeof value === 'string' && (COMMERCIAL_MOTIONS as readonly string[]).includes(value)) return value as CommercialMotion;
  if (capabilities.bookings && capabilities.sales) return 'hybrid';
  if (capabilities.bookings) return 'booking';
  if (capabilities.sales) return 'sales';
  return 'enquiry';
}

/**
 * A selected motion is a capability floor, not a consequence of the first
 * catalogue row entered during onboarding. This keeps a hybrid business ready
 * to sell even when its owner adds products later.
 */
export function capabilitiesForCommercialMotion(motion: CommercialMotion, options: { hasInventory?: boolean } = {}): TenantCapabilities {
  const bookings = motion === 'booking' || motion === 'hybrid';
  const sales = motion === 'sales' || motion === 'hybrid';
  return { bookings, sales, inventory: sales && Boolean(options.hasInventory), crm: true, support: true };
}

export function primaryActionForCommercialMotion(motion: CommercialMotion): { label: string; kind: 'book' | 'shop' | 'ask' } {
  if (motion === 'sales') return { label: 'Shop now', kind: 'shop' };
  if (motion === 'enquiry') return { label: 'Ask Booka', kind: 'ask' };
  if (motion === 'booking') return { label: 'Book now', kind: 'book' };
  return { label: 'Book now', kind: 'book' };
}
