import { describe, it, expect } from '@jest/globals';
import { siteMetadata as metadata } from '@/app/siteMetadata';

/**
 * Booka is sold into WhatsApp, and every Techclave link shared there rendered
 * as a bare text card because the site had no Open Graph metadata at all.
 */

describe('site metadata', () => {
  it('has an Open Graph image at the standard preview size', () => {
    const images = metadata.openGraph?.images as Array<Record<string, unknown>>;
    expect(images?.[0]).toMatchObject({
      url: '/brand/techclave-og.jpg', width: 1200, height: 630,
    });
    expect(images[0].alt).toBeTruthy();
  });

  it('sets metadataBase, without which a relative OG image never resolves', () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL);
  });

  it('asks for the large Twitter card rather than the thumbnail one', () => {
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('keeps the title and description in step across all three', () => {
    // Drift here shows up as a preview that disagrees with the page.
    expect(metadata.openGraph?.title).toBe(metadata.title);
    expect(metadata.twitter?.title).toBe(metadata.title);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });
});
