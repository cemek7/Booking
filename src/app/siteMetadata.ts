import type { Metadata } from 'next';

/**
 * Site-level metadata, kept out of layout.tsx so it can be asserted on without
 * pulling in fonts and the whole React tree.
 *
 * Booka is sold into WhatsApp, and until this existed every Techclave link
 * shared there — or on LinkedIn, or in Slack — rendered as a bare text card
 * with no image. The product's own links were the least branded thing about it,
 * in exactly the channel it sells into.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://techclave.cloud';

export const SITE_TITLE = 'Techclave | AI Operating Systems for African Businesses';

export const SITE_DESCRIPTION =
  'Techclave builds AI products for customer operations. Booka is the first product: an AI '
  + 'Revenue Front Desk that turns WhatsApp and Instagram enquiries into booked and paying customers.';

export const OG_IMAGE = '/brand/techclave-og.jpg';

export const siteMetadata: Metadata = {
  // Without metadataBase, Next cannot resolve the relative OG image and the
  // preview silently falls back to a text card.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Techclave',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [{
      url: OG_IMAGE,
      width: 1200,
      height: 630,
      alt: 'Techclave — intelligence builds what’s next',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};
