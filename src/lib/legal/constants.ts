// Centralized legal-document constants. Keep page copy DRY.
// Verified against Techclave's CAC certificate and status report.

export const LEGAL = {
  /** Operating product/company name shown in legal copy. */
  company: "Techclave",
  product: "Boka",
  entity: "Techclave Ltd",
  registrationNumber: "RC 8489929",
  registeredAddress: "25, Ndola Crescent, Wuse Zone 5, FCT, Nigeria",
  /**
   * Mailboxes on techclave.cloud, received through Cloudflare Email Routing.
   *
   * These were on boka.app, a domain Techclave does not own: it is parked for
   * sale, and its mail already routes to someone else's forwarding service. The
   * privacy policy was telling people to send data-protection requests there.
   * Every address here must have a routing rule before the page goes out —
   * src/__tests__/site/emailDomains.test.ts fails on any address whose domain we
   * do not control.
   */
  privacyEmail: "privacy@techclave.cloud",
  legalEmail: "legal@techclave.cloud",
  supportEmail: "support@techclave.cloud",
  /**
   * Single-source product positioning, referenced across the legal pages.
   * Boka is an AI front desk: it runs customer conversations for service
   * businesses and also enables selling services/products and taking bookings.
   */
  descriptor:
    "an AI front desk for service businesses. Over WhatsApp and Instagram, Boka runs customer " +
    "conversations — answering questions, qualifying and capturing leads, recommending and selling " +
    "services and products, and booking appointments",
  /** Single source of truth for the "last updated" date across all pages. */
  lastUpdated: "2026-09-23",
} as const;

/** Third parties that may process personal data on Boka's behalf. */
export interface SubProcessor {
  name: string;
  purpose: string;
  /** Where the sub-processor is primarily established (for transfer notes). */
  region: string;
}

export const SUB_PROCESSORS: SubProcessor[] = [
  {
    name: "Supabase",
    purpose: "Database, authentication, and file storage",
    region: "USA / EU",
  },
  { name: "Stripe", purpose: "Card payment processing", region: "USA / EU" },
  {
    name: "Paystack",
    purpose: "Payment processing and payouts (Africa)",
    region: "Nigeria / South Africa",
  },
  {
    name: "SendGrid (Twilio)",
    purpose: "Transactional and notification email",
    region: "USA",
  },
  { name: "Twilio", purpose: "SMS and voice notifications", region: "USA" },
  {
    name: "Meta Platforms (WhatsApp, Instagram)",
    purpose: "Messaging channels for customer conversations",
    region: "USA / EU",
  },
  {
    name: "Evolution API provider",
    purpose: "WhatsApp gateway connectivity",
    region: "Varies by deployment",
  },
  {
    name: "Google (Calendar)",
    purpose: "Optional calendar synchronization",
    region: "USA / EU",
  },
  {
    name: "PostHog",
    purpose: "Product analytics and session replay (consent-gated)",
    region: "EU / USA (configurable)",
  },
  {
    name: "Sentry",
    purpose: "Error and performance monitoring",
    region: "USA / EU",
  },
  {
    name: "LLM provider(s)",
    purpose: "AI message understanding and drafting (no special-category data)",
    region: "USA / EU",
  },
];
