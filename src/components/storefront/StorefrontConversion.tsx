'use client';

import { useMemo } from 'react';

type Props = { slug: string; tenantId: string; label: string; href: string; pageType: 'storefront' | 'service' | 'product' | 'campaign'; serviceId?: string; productId?: string; campaignId?: string; priceLabel?: string };

function sessionId() {
  if (typeof window === 'undefined') return undefined;
  const key = 'booka_storefront_session';
  const current = window.sessionStorage.getItem(key);
  if (current) return current;
  const next = crypto.randomUUID(); window.sessionStorage.setItem(key, next); return next;
}

export function ConversionLink({ slug, tenantId, label, href, pageType, serviceId, productId, campaignId, priceLabel }: Props) {
  const event = useMemo(() => ({ tenant_id: tenantId, page_type: pageType, service_id: serviceId, product_id: productId, campaign_id: campaignId, session_id: sessionId() }), [tenantId, pageType, serviceId, productId, campaignId]);
  return <a href={href} onClick={() => { void fetch(`/api/public/${slug}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...event, event_type: 'cta_click', metadata: { label } }) }); }} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#12261c] px-5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(18,38,28,.18)] transition hover:-translate-y-0.5 hover:bg-[#254b37]">{priceLabel ? `${label} · ${priceLabel}` : label}</a>;
}

export function AskBookaButton({ slug, tenantId, pageType, serviceId, productId, campaignId }: Omit<Props, 'label' | 'href' | 'priceLabel'>) {
  async function open() {
    const response = await fetch(`/api/public/${slug}/front-desk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant_id: tenantId, page_type: pageType, service_id: serviceId, product_id: productId, campaign_id: campaignId, session_id: sessionId(), referrer: document.referrer || undefined }) });
    const data = await response.json().catch(() => ({}));
    if (data.whatsappUrl) window.location.assign(data.whatsappUrl);
  }
  return <button type="button" onClick={() => void open()} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#b7c9bc] bg-white px-5 text-sm font-bold text-[#173423] transition hover:bg-[#f0f6ef]">Ask Booka</button>;
}

export function StickyConversionBar(props: Props) {
  return <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d7e1d7] bg-white/95 px-4 py-3 backdrop-blur md:hidden"><div className="mx-auto flex max-w-xl items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-xs text-[#5b6c60]">{props.priceLabel ?? 'Ready when you are'}</p><p className="truncate text-sm font-bold text-[#12261c]">{props.label}</p></div><ConversionLink {...props} /></div></div>;
}
