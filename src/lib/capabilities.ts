import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tenant capabilities — which Booka workflows a tenant actually runs.
 *
 * Orthogonal to role (who) and to the vertical-module system (industry). A
 * sales-only shop turns `bookings` off and never sees Bookings/Schedule/Services;
 * a bookings-only salon turns `sales`/`inventory` off. Stored as
 * `tenants.settings.capabilities`. Default is ALL-ON, so existing tenants and
 * any unset capability behave exactly as before — trimming is opt-in.
 */
export const ALL_CAPABILITIES = ['bookings', 'sales', 'inventory', 'crm', 'support'] as const;
export type Capability = (typeof ALL_CAPABILITIES)[number];
export type TenantCapabilities = Record<Capability, boolean>;

export const DEFAULT_CAPABILITIES: TenantCapabilities = {
  bookings: true,
  sales: true,
  inventory: true,
  crm: true,
  support: true,
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  bookings: 'Bookings',
  sales: 'Sales',
  inventory: 'Inventory',
  crm: 'Customers & Leads',
  support: 'Support',
};

export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  bookings: 'Appointments, schedule, services and staff.',
  sales: 'Product orders, catalogue and showcase.',
  inventory: 'Stock levels and inventory tracking (needs Sales).',
  crm: 'Customer records and the leads pipeline.',
  support: 'Support tickets and FAQs.',
};

/**
 * Coerce an unknown settings.capabilities blob into a full TenantCapabilities.
 * Anything missing or non-boolean defaults to TRUE (all-on posture). Inventory
 * implies Sales — inventory is meaningless without a catalogue.
 */
export function resolveCapabilities(raw: unknown): TenantCapabilities {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_CAPABILITIES };
  for (const cap of ALL_CAPABILITIES) {
    if (typeof source[cap] === 'boolean') result[cap] = source[cap] as boolean;
  }
  // Inventory depends on sales: if sales is off, inventory is off too.
  if (!result.sales) result.inventory = false;
  return result;
}

/**
 * Read a tenant's capabilities from `tenants.settings.capabilities`.
 * Falls back to all-on if the row/column/blob is absent.
 */
export async function getTenantCapabilities(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TenantCapabilities> {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_CAPABILITIES };
    const settings = (data as { settings?: Record<string, unknown> | null }).settings;
    const caps = settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).capabilities
      : null;
    return resolveCapabilities(caps);
  } catch {
    return { ...DEFAULT_CAPABILITIES };
  }
}

/**
 * Map a dashboard route to the capability that gates it, or null for always-on
 * routes (home, analytics, chats, tasks, settings, billing, superadmin…).
 * Most-specific paths are checked first (inventory before products).
 */
export function capabilityForHref(href: string): Capability | null {
  const h = href.toLowerCase();
  // inventory is a sub-path of /dashboard/products — check it first
  if (h.startsWith('/dashboard/products/inventory')) return 'inventory';
  if (h.startsWith('/dashboard/products')) return 'sales';
  if (h.startsWith('/dashboard/orders')) return 'sales';
  if (h.startsWith('/dashboard/showcase')) return 'sales';
  if (h.startsWith('/dashboard/pos')) return 'sales';
  if (h.startsWith('/dashboard/pos')) return 'sales';
  if (h.startsWith('/dashboard/bookings')) return 'bookings';
  if (h.startsWith('/dashboard/services')) return 'bookings';
  if (h.startsWith('/dashboard/staff')) return 'bookings';
  if (h.includes('/schedule')) return 'bookings';
  if (h.startsWith('/dashboard/customers')) return 'crm';
  if (h.startsWith('/dashboard/leads')) return 'crm';
  if (h.startsWith('/dashboard/support')) return 'support';
  if (h.startsWith('/dashboard/faqs')) return 'support';
  return null;
}

/** True when a route is visible given the tenant's capabilities. */
export function isRouteEnabled(href: string, caps: TenantCapabilities): boolean {
  const cap = capabilityForHref(href);
  return cap == null || caps[cap];
}
