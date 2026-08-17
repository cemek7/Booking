import { PRODUCTS, PRODUCT_LIST, type ProductSlug } from '@/lib/products/registry';

/**
 * Dashboard path mapping between a product's public workspace URL and the
 * internal App Router segment it rewrites to. Driven by the product registry
 * (`@/lib/products/registry`) so adding a product is a data change, not a code
 * change here or in middleware.
 */

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Internal App Router path (e.g. '/dashboard/x') → a product's public workspace URL (e.g. '/booka/dashboard/x'). */
export function toProductDashboardPath(slug: ProductSlug, pathname: string): string {
  const product = PRODUCTS[slug];
  if (isUnder(pathname, product.internalDashboardPrefix)) {
    return `${product.publicDashboardPrefix}${pathname.slice(product.internalDashboardPrefix.length)}`;
  }
  return pathname;
}

/** Any registered product's public workspace URL → its internal App Router path. */
export function toInternalDashboardPath(pathname: string): string {
  for (const product of PRODUCT_LIST) {
    if (isUnder(pathname, product.publicDashboardPrefix)) {
      return `${product.internalDashboardPrefix}${pathname.slice(product.publicDashboardPrefix.length)}`;
    }
  }
  return pathname;
}

/** True if `pathname` is under any registered product's public workspace prefix. */
export function isProductDashboardPath(pathname: string): boolean {
  return PRODUCT_LIST.some((product) => isUnder(pathname, product.publicDashboardPrefix));
}

// --- Booka-specific aliases (preserved for existing callers) ---------------
// These keep the original API stable while the implementation is registry-driven.

/** Internal '/dashboard/x' → public '/booka/dashboard/x'. */
export function toBookaDashboardPath(pathname: string): string {
  return toProductDashboardPath('booka', pathname);
}

/** True if `pathname` is under the Booka public workspace prefix. */
export function isBookaDashboardPath(pathname: string): boolean {
  return isUnder(pathname, PRODUCTS.booka.publicDashboardPrefix);
}
