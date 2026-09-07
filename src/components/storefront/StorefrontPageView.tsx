'use client';
import { useEffect } from 'react';
export default function StorefrontPageView({ slug, pageType, serviceId, productId, campaignId, tenantId }: { slug: string; tenantId: string; pageType: 'storefront' | 'service' | 'product' | 'campaign'; serviceId?: string; productId?: string; campaignId?: string }) {
  useEffect(() => { const key = 'booka_storefront_session'; let sessionId = window.sessionStorage.getItem(key); if (!sessionId) { sessionId = crypto.randomUUID(); window.sessionStorage.setItem(key, sessionId); } void fetch(`/api/public/${slug}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: pageType === 'service' ? 'service_view' : pageType === 'product' ? 'product_view' : pageType === 'campaign' ? 'campaign_view' : 'storefront_view', page_type: pageType, tenant_id: tenantId, session_id: sessionId, service_id: serviceId, product_id: productId, campaign_id: campaignId, referrer: document.referrer || undefined }) }); }, [slug, tenantId, pageType, serviceId, productId, campaignId]);
  return null;
}
