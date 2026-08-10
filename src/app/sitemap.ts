import type { MetadataRoute } from 'next';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { publicItemSlug } from '@/lib/storefront/config';

/** Public acquisition routes only; unpublished/offboarded tenants are excluded. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: tenants }, { data: services }, { data: products }] = await Promise.all([
      admin.from('tenants').select('id,slug,updated_at,lifecycle_state').not('slug', 'is', null).or('lifecycle_state.is.null,lifecycle_state.eq.active'),
      admin.from('services').select('id,tenant_id,name,created_at').eq('is_active', true),
      admin.from('products').select('id,tenant_id,name,updated_at').eq('is_active', true),
    ]);
    const byTenant = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant]));
    return [
      ...(tenants ?? []).flatMap((tenant) => tenant.slug ? [{ url: `/${tenant.slug}`, lastModified: tenant.updated_at ? new Date(tenant.updated_at) : undefined, changeFrequency: 'weekly' as const, priority: 0.9 }] : []),
      ...(services ?? []).flatMap((service) => { const tenant = byTenant.get(service.tenant_id); return tenant?.slug ? [{ url: `/${tenant.slug}/services/${publicItemSlug(service.name, service.id)}`, lastModified: service.created_at ? new Date(service.created_at) : undefined, changeFrequency: 'weekly' as const, priority: 0.8 }] : []; }),
      ...(products ?? []).flatMap((product) => { const tenant = byTenant.get(product.tenant_id); return tenant?.slug ? [{ url: `/${tenant.slug}/products/${publicItemSlug(product.name, product.id)}`, lastModified: product.updated_at ? new Date(product.updated_at) : undefined, changeFrequency: 'weekly' as const, priority: 0.7 }] : []; }),
    ];
  } catch { return []; }
}
