import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantServices, getTenantPublicInfo } from '@/lib/publicBookingService';
import { getTenantProducts, type PublicProduct } from '@/lib/publicStorefrontService';
import { getTenantCurrency } from '@/lib/tenant-currency';
import { resolveStorefrontConfig, type StorefrontConfig } from './config';

export type StorefrontService = {
  id: string; name: string; description: string | null; duration_minutes: number; price_cents: number; image_url: string | null; category: string | null;
};
export type StorefrontReview = { id: string; customer_name: string; rating: number; comment: string | null };
export type StorefrontFaq = { id: string; question: string; answer: string; category: string | null };
export type StorefrontStaff = { id: string; name: string; services: string[] };
export type StorefrontCampaign = { id: string; title: string; copy: string | null; cta_label: string | null; target_type: string | null; target_ids: string[] };

export type PublicStorefront = {
  tenant: { id: string; slug: string; name: string; description: string | null; logo: string | null; industry: string | null; phone: string | null; address: string | null; website: string | null; routingCode: string | null; settings: Record<string, unknown> };
  currency: string; config: StorefrontConfig; services: StorefrontService[]; products: PublicProduct[]; reviews: StorefrontReview[]; faqs: StorefrontFaq[]; staff: StorefrontStaff[]; campaign: StorefrontCampaign | null;
};

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

export async function getPublicStorefront(slug: string): Promise<PublicStorefront> {
  const admin = createSupabaseAdminClient();
  const tenantInfo = await getTenantPublicInfo(slug);
  const { data: row, error } = await admin.from('tenants').select('settings, metadata, whatsapp_number, routing_code, lifecycle_state').eq('id', tenantInfo.id).maybeSingle();
  if (error || !row || (row.lifecycle_state && row.lifecycle_state !== 'active')) throw new Error('Tenant not found');
  const settings = record(row.settings);
  const metadata = record(row.metadata);
  const ui = record(metadata.ui_settings);
  const mergedSettings = { ...ui, ...settings };
  const [serviceRows, products, reviewsResult, faqsResult, staffResult, currency, campaignResult] = await Promise.all([
    getTenantServices(tenantInfo.id), getTenantProducts(tenantInfo.id),
    admin.from('reviews').select('id, customer_name, rating, overall_rating, comment, review_text').eq('tenant_id', tenantInfo.id).eq('is_published', true).eq('hidden', false).order('created_at', { ascending: false }).limit(12),
    admin.from('faqs').select('id, question, answer, category').eq('tenant_id', tenantInfo.id).eq('is_active', true).order('sort_order').limit(20),
    admin.from('tenant_users').select('user_id, name').eq('tenant_id', tenantInfo.id).neq('role', 'owner').not('name', 'is', null).limit(12),
    getTenantCurrency(admin, tenantInfo.id, 'NGN'),
    admin.from('storefront_campaigns').select('id,title,copy,cta_label,target_type,target_ids').eq('tenant_id', tenantInfo.id).eq('status', 'active').lte('start_at', new Date().toISOString()).or(`end_at.is.null,end_at.gte.${new Date().toISOString()}`).order('start_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const services = (serviceRows as Array<Record<string, unknown>>).map((service) => ({
    id: String(service.id), name: String(service.name), description: typeof service.description === 'string' ? service.description : null,
    duration_minutes: Number(service.duration_minutes ?? service.duration ?? 0), price_cents: Number(service.price_cents ?? service.price ?? 0),
    image_url: typeof service.image_url === 'string' ? service.image_url : null, category: typeof (service as Record<string, unknown>).category === 'string' ? String((service as Record<string, unknown>).category) : null,
  }));
  const staffServices = await admin.from('staff_services').select('staff_user_id, service_id').eq('tenant_id', tenantInfo.id);
  const staff = ((staffResult.data ?? []) as Array<{ user_id: string; name: string }>).map((member) => ({ id: String(member.user_id), name: String(member.name), services: ((staffServices.data ?? []) as Array<{ staff_user_id: string; service_id: string }>).filter((mapping) => mapping.staff_user_id === member.user_id).map((mapping) => String(mapping.service_id)) }));
  const campaign = campaignResult.error ? null : campaignResult.data ? { ...campaignResult.data, copy: campaignResult.data.copy ?? null, cta_label: campaignResult.data.cta_label ?? null, target_type: campaignResult.data.target_type ?? null, target_ids: Array.isArray(campaignResult.data.target_ids) ? campaignResult.data.target_ids as string[] : [] } : null;
  return {
    tenant: { id: tenantInfo.id, slug: tenantInfo.slug, name: tenantInfo.name, description: tenantInfo.description ?? null, logo: tenantInfo.logo ?? null, industry: tenantInfo.industry ?? null, phone: typeof metadata.phone === 'string' ? metadata.phone : null, address: typeof metadata.address === 'string' ? metadata.address : null, website: typeof metadata.website === 'string' ? metadata.website : null, routingCode: typeof row.routing_code === 'string' ? row.routing_code : null, settings: mergedSettings },
    currency, config: resolveStorefrontConfig({ industry: tenantInfo.industry, settings: mergedSettings }), services, products,
    reviews: ((reviewsResult.data ?? []) as Array<Record<string, unknown>>).map((review) => ({ id: String(review.id), customer_name: String(review.customer_name ?? 'Customer'), rating: Number(review.rating ?? review.overall_rating ?? 0), comment: (review.comment ?? review.review_text ?? null) as string | null })).filter((review) => review.rating > 0),
    faqs: ((faqsResult.data ?? []) as Array<Record<string, unknown>>).map((faq) => ({ id: String(faq.id), question: String(faq.question), answer: String(faq.answer), category: typeof faq.category === 'string' ? faq.category : null })), staff, campaign,
  };
}

export async function getPublicService(slug: string, serviceId: string) {
  const storefront = await getPublicStorefront(slug);
  const service = storefront.services.find((item) => item.id === serviceId);
  return service ? { storefront, service } : null;
}

export async function getPublicProduct(slug: string, productId: string) {
  const storefront = await getPublicStorefront(slug);
  const product = storefront.products.find((item) => item.id === productId);
  return product ? { storefront, product } : null;
}
