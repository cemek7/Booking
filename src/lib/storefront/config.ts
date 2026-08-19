export const STOREFRONT_BLOCK_IDS = [
  'hero', 'business_intro', 'service_categories', 'featured_services', 'service_grid',
  'product_grid', 'gallery', 'staff', 'reviews', 'benefits', 'packages', 'faq',
  'business_hours', 'location', 'promotion', 'related_services', 'related_products',
  'ai_front_desk_cta', 'final_cta',
] as const;

export type StorefrontBlockId = (typeof STOREFRONT_BLOCK_IDS)[number];
export type StorefrontVertical = 'beauty' | 'healthcare' | 'hospitality' | 'professional' | 'retail' | 'home_services' | 'general';

export type StorefrontBlock = { id: StorefrontBlockId; visible?: boolean; heading?: string; limit?: number };
export type StorefrontConfig = { template: StorefrontVertical; blocks: StorefrontBlock[]; primaryCta?: string };

const TEMPLATES: Record<StorefrontVertical, StorefrontBlockId[]> = {
  beauty: ['hero', 'featured_services', 'gallery', 'staff', 'reviews', 'packages', 'product_grid', 'faq', 'location', 'ai_front_desk_cta', 'final_cta'],
  healthcare: ['hero', 'service_grid', 'staff', 'benefits', 'business_hours', 'reviews', 'faq', 'location', 'ai_front_desk_cta', 'final_cta'],
  hospitality: ['hero', 'featured_services', 'benefits', 'gallery', 'business_hours', 'reviews', 'location', 'faq', 'final_cta'],
  professional: ['hero', 'business_intro', 'service_grid', 'benefits', 'reviews', 'packages', 'faq', 'ai_front_desk_cta', 'final_cta'],
  retail: ['hero', 'service_categories', 'product_grid', 'promotion', 'reviews', 'related_products', 'ai_front_desk_cta', 'final_cta'],
  home_services: ['hero', 'service_grid', 'benefits', 'reviews', 'location', 'faq', 'ai_front_desk_cta', 'final_cta'],
  general: ['hero', 'featured_services', 'product_grid', 'reviews', 'faq', 'location', 'ai_front_desk_cta', 'final_cta'],
};

export function resolveStorefrontVertical(industry?: string | null): StorefrontVertical {
  const value = (industry ?? '').toLowerCase();
  if (/beauty|salon|spa|barber|nail|hair/.test(value)) return 'beauty';
  if (/clinic|health|medical|dental|wellness/.test(value)) return 'healthcare';
  if (/hotel|hospitality|lodging|restaurant/.test(value)) return 'hospitality';
  if (/retail|shop|store|commerce/.test(value)) return 'retail';
  if (/home|cleaning|repair|automotive|local service/.test(value)) return 'home_services';
  if (/consult|legal|account|agency|professional/.test(value)) return 'professional';
  return 'general';
}

function isBlockId(value: unknown): value is StorefrontBlockId {
  return typeof value === 'string' && (STOREFRONT_BLOCK_IDS as readonly string[]).includes(value);
}

/** Generates a useful page for every existing tenant; settings only override it. */
export function resolveStorefrontConfig(input: { industry?: string | null; settings?: Record<string, unknown> | null }): StorefrontConfig {
  const fallback: StorefrontVertical = resolveStorefrontVertical(input.industry);
  const candidate = input.settings?.storefront;
  if (!candidate || typeof candidate !== 'object') {
    return { template: fallback, blocks: TEMPLATES[fallback].map((id) => ({ id })) };
  }
  const raw = candidate as Record<string, unknown>;
  const template = typeof raw.template === 'string' && raw.template in TEMPLATES ? raw.template as StorefrontVertical : fallback;
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks.flatMap((block): StorefrontBlock[] => {
      if (typeof block === 'string' && isBlockId(block)) return [{ id: block }];
      if (!block || typeof block !== 'object') return [];
      const item = block as Record<string, unknown>;
      return isBlockId(item.id) ? [{
        id: item.id,
        visible: item.visible !== false,
        heading: typeof item.heading === 'string' ? item.heading.slice(0, 120) : undefined,
        limit: typeof item.limit === 'number' ? Math.max(1, Math.min(Math.floor(item.limit), 24)) : undefined,
      }] : [];
    })
    : [];
  return {
    template,
    blocks: blocks.length ? blocks : TEMPLATES[template].map((id) => ({ id })),
    primaryCta: typeof raw.primaryCta === 'string' ? raw.primaryCta : undefined,
  };
}

export function publicItemSlug(name: string, id: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
  return `${base}-${id}`;
}

export function idFromPublicItemSlug(slug: string): string | null {
  const match = /([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.exec(slug);
  return match?.[1] ?? null;
}
