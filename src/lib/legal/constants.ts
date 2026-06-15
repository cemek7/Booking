// Centralized legal-document constants. Keep page copy DRY.
// TODO (owner): confirm legal entity name, registered address, and contact emails
// before these pages are published / reviewed by counsel.

export const LEGAL = {
  /** Operating product/company name shown in legal copy. */
  company: 'Techclave',
  product: 'Boka',
  /** TODO: confirm registered legal entity + address. */
  entity: 'Techclave (legal entity to be confirmed)',
  /** TODO: confirm these mailboxes exist and are monitored. */
  privacyEmail: 'privacy@boka.app',
  legalEmail: 'legal@boka.app',
  supportEmail: 'support@boka.app',
  /** Single source of truth for the "last updated" date across all pages. */
  lastUpdated: '2026-06-15',
} as const;

/** Third parties that may process personal data on Boka's behalf. */
export interface SubProcessor {
  name: string;
  purpose: string;
  /** Where the sub-processor is primarily established (for transfer notes). */
  region: string;
}

export const SUB_PROCESSORS: SubProcessor[] = [
  { name: 'Supabase', purpose: 'Database, authentication, and file storage', region: 'USA / EU' },
  { name: 'Stripe', purpose: 'Card payment processing', region: 'USA / EU' },
  { name: 'Paystack', purpose: 'Payment processing and payouts (Africa)', region: 'Nigeria / South Africa' },
  { name: 'SendGrid (Twilio)', purpose: 'Transactional and notification email', region: 'USA' },
  { name: 'Twilio', purpose: 'SMS and voice notifications', region: 'USA' },
  { name: 'Meta Platforms (WhatsApp, Instagram)', purpose: 'Messaging channels for customer conversations', region: 'USA / EU' },
  { name: 'Evolution API provider', purpose: 'WhatsApp gateway connectivity', region: 'Varies by deployment' },
  { name: 'Google (Calendar)', purpose: 'Optional calendar synchronization', region: 'USA / EU' },
  { name: 'PostHog', purpose: 'Product analytics and session replay (consent-gated)', region: 'EU / USA (configurable)' },
  { name: 'Sentry', purpose: 'Error and performance monitoring', region: 'USA / EU' },
  { name: 'LLM provider(s)', purpose: 'AI message understanding and drafting (no special-category data)', region: 'USA / EU' },
];
