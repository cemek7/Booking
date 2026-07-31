export const dynamic = 'force-dynamic';
import { defaultLogger } from '@/lib/logger';
import { notFound } from 'next/navigation';
import { getTenantPublicInfo } from '@/lib/publicBookingService';
import { getTenantProducts } from '@/lib/publicStorefrontService';
import { getTenantCurrency } from '@/lib/tenant-currency';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import StorefrontContainer from './components/StorefrontContainer';

interface StorefrontPageProps {
  // Next 16: route params are async and must be awaited.
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: StorefrontPageProps) {
  const { slug } = await params;
  try {
    const tenant = await getTenantPublicInfo(slug);
    return {
      title: `${tenant.name} — Shop`,
      description: tenant.description || `Browse and order from ${tenant.name}`,
    };
  } catch {
    return { title: 'Shop', description: 'Browse and order online' };
  }
}

export default async function StorefrontPage({ params }: StorefrontPageProps) {
  const { slug } = await params;
  try {
    const tenant = await getTenantPublicInfo(slug);
    if (!tenant) notFound();

    const [products, currency] = await Promise.all([
      getTenantProducts(tenant.id).catch(() => []),
      getTenantCurrency(createSupabaseAdminClient(), tenant.id, 'NGN').catch(() => 'NGN'),
    ]);

    return (
      <StorefrontContainer
        slug={slug}
        tenant={{ name: tenant.name, description: tenant.description ?? null, logo: tenant.logo ?? null }}
        products={products}
        currency={currency}
      />
    );
  } catch (error) {
    defaultLogger.error(`Error loading storefront for slug: ${slug}`, error);
    notFound();
  }
}
