/**
 * Product registry — the single source of truth for Techclave's products and
 * how each one's public workspace URL maps to its internal App Router segment.
 *
 * Today there is exactly one product (Booka). Its public workspace lives at
 * `/booka/dashboard/*` while the actual App Router pages live at `/dashboard/*`;
 * middleware rewrites between the two (see `src/lib/navigation/dashboard-path.ts`).
 *
 * When a second product ships, add an entry here — the path mapping, middleware
 * rewrite, and nav all read from this registry, so no routing/middleware code has
 * to change. Give each new product its OWN `internalDashboardPrefix` (do not share
 * `/dashboard`, or the public→internal reverse mapping becomes ambiguous).
 */

export type ProductSlug = 'booka';

export interface ProductConfig {
  /** URL slug and registry key, e.g. 'booka'. */
  slug: ProductSlug;
  /** Human-facing product name. */
  name: string;
  /** Public workspace URL prefix, e.g. '/booka/dashboard'. */
  publicDashboardPrefix: string;
  /** Internal App Router prefix the public prefix rewrites to, e.g. '/dashboard'. */
  internalDashboardPrefix: string;
}

export const PRODUCTS: Record<ProductSlug, ProductConfig> = {
  booka: {
    slug: 'booka',
    name: 'Booka',
    publicDashboardPrefix: '/booka/dashboard',
    internalDashboardPrefix: '/dashboard',
  },
};

/** All registered products, in registry order. */
export const PRODUCT_LIST: ProductConfig[] = Object.values(PRODUCTS);
