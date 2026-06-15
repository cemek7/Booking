import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Cookie Policy | Boka',
  description: 'How Boka uses cookies and similar technologies.',
};

export default function CookiesPage() {
  return (
    <LegalDocument title="Cookie Policy" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="What we use">
        <ul>
          <li><strong>Essential cookies</strong> — required to sign in and run the platform. Always on.</li>
          <li><strong>Analytics cookies</strong> — product analytics and session replay (PostHog) to improve the product. Set <strong>only with your consent</strong>.</li>
          <li><strong>Error monitoring</strong> — Sentry helps us detect and fix faults; it runs as essential reliability tooling and is configured not to collect unnecessary personal data.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your choices">
        <p>
          On your first visit you can <strong>Accept all</strong> or <strong>Reject non-essential</strong>{' '}
          cookies via our consent banner. Analytics and session replay do not run until you consent. You
          can clear your choice by clearing this site&apos;s data in your browser, which will show the banner
          again.
        </p>
      </LegalSection>

      <LegalSection heading="More information">
        <p>
          See our <a href="/privacy">Privacy Policy</a> for how we handle personal data, or contact{' '}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
