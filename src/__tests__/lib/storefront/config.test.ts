import { describe, expect, it } from '@jest/globals';
import { idFromPublicItemSlug, publicItemSlug, resolveStorefrontConfig, resolveStorefrontVertical } from '@/lib/storefront/config';

describe('storefront configuration', () => {
  it('generates a beauty storefront without saved tenant configuration', () => {
    const config = resolveStorefrontConfig({ industry: 'Salon and beauty' });
    expect(config.template).toBe('beauty');
    expect(config.blocks.map((block) => block.id)).toContain('staff');
    expect(config.blocks.map((block) => block.id)).toContain('featured_services');
  });
  it('keeps supported ordered blocks and drops unsupported blocks', () => {
    const config = resolveStorefrontConfig({ industry: 'retail', settings: { storefront: { template: 'retail', blocks: [{ id: 'hero' }, { id: 'not-real' }, { id: 'product_grid', visible: false }] } } });
    expect(config.blocks).toEqual([{ id: 'hero', visible: true }, { id: 'product_grid', visible: false }]);
  });
  it('uses stable ID-suffixed public URLs even when the display name changes', () => {
    const id = '1a2b3c4d-1234-5678-9abc-def012345678';
    expect(idFromPublicItemSlug(publicItemSlug('Knotless Braids', id))).toBe(id);
    expect(idFromPublicItemSlug(publicItemSlug('New name', id))).toBe(id);
  });
  it('maps supported business vocabulary to verticals', () => {
    expect(resolveStorefrontVertical('dental clinic')).toBe('healthcare');
    expect(resolveStorefrontVertical('home cleaning')).toBe('home_services');
  });
});
