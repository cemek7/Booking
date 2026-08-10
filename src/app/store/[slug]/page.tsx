export const dynamic = 'force-dynamic';
import { defaultLogger } from '@/lib/logger';
import { notFound } from 'next/navigation';
import { getTenantPublicInfo } from '@/lib/publicBookingService';
import { getTenantProducts } from '@/lib/publicStorefrontService';
import { getTenantCurrency } from '@/lib/tenant-currency';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import StorefrontContainer from './components/StorefrontContainer';
interface StorefrontPageProps { params: Promise<{ slug: string }>; searchParams: Promise<{ add?: string }> }
async function loadStorefront(slug: string) { try { const tenant = await getTenantPublicInfo(slug); const [products, currency] = await Promise.all([getTenantProducts(tenant.id).catch(() => []), getTenantCurrency(createSupabaseAdminClient(), tenant.id, 'NGN').catch(() => 'NGN')]); return { tenant, products, currency }; } catch (error) { defaultLogger.error(`Error loading storefront for slug: ${slug}`, error); return null; } }
export async function generateMetadata({ params }: StorefrontPageProps) { const data = await loadStorefront((await params).slug); return data ? { title: `${data.tenant.name} — Shop`, description: data.tenant.description || `Browse and order from ${data.tenant.name}` } : { title: 'Shop', description: 'Browse and order online' }; }
export default async function StorefrontPage({ params, searchParams }: StorefrontPageProps) { const { slug } = await params; const { add } = await searchParams; const data = await loadStorefront(slug); if (!data) notFound(); return <StorefrontContainer slug={slug} tenant={{ name: data.tenant.name, description: data.tenant.description ?? null, logo: data.tenant.logo ?? null }} products={data.products} currency={data.currency} initialProductId={typeof add === 'string' ? add : undefined} />; }
