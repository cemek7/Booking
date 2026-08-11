import type { MetadataRoute } from 'next';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { publicItemSlug } from '@/lib/storefront/config';

type SitemapTenant = { id: string; slug: string | null; updated_at: string | null };
type SitemapService = { id: string; tenant_id: string; name: string; created_at: string | null };
type SitemapProduct = { id: string; tenant_id: string; name: string; updated_at: string | null };

/** Public acquisition routes only; unpublished/offboarded tenants are excluded. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: tenants }, { data: services }, { data: products }] = await Promise.all([
      admin.from('tenants').select('id,slug,updated_at,lifecycle_state').not('slug', 'is', null).or('lifecycle_state.is.null,lifecycle_state.eq.active'),
      admin.from('services').select('id,tenant_id,name,created_at').eq('is_active', true),
      admin.from('products').select('id,tenant_id,name,updated_at').eq('is_active', true),
    ]);
    const tenantRows = (tenants ?? []) as SitemapTenant[];
    const serviceRows = (services ?? []) as SitemapService[];
    const productRows = (products ?? []) as SitemapProduct[];
    const byTenant = new Map(tenantRows.map((tenant) => [tenant.id, tenant]));
    return [
      ...tenantRows.flatMap((tenant) => tenant.slug ? [{ url: `/${tenant.slug}`, lastModified: tenant.updated_at ? new Date(tenant.updated_at) : undefined, changeFrequency: 'weekly' as const, priority: 0.9 }] : []),
      ...serviceRows.flatMap((service) => { const tenant = byTenant.get(service.tenant_id); return tenant?.slug ? [{ url: `/${tenant.slug}/services/${publicItemSlug(service.name, service.id)}`, lastModified: service.created_at ? new Date(service.created_at) : undefined, changeFrequency: 'weekly' as const, priority: 0.8 }] : []; }),
      ...productRows.flatMap((product) => { const tenant = byTenant.get(product.tenant_id); return tenant?.slug ? [{ url: `/${tenant.slug}/products/${publicItemSlug(product.name, product.id)}`, lastModified: product.updated_at ? new Date(product.updated_at) : undefined, changeFrequency: 'weekly' as const, priority: 0.7 }] : []; }),
    ];
  } catch { return []; }
}
