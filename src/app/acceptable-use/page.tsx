import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Acceptable Use Policy | Boka',
  description: 'Rules for acceptable use of the Boka platform.',
};

export default function AcceptableUsePage() {
  return (
    <LegalDocument title="Acceptable Use Policy" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Purpose">
        <p>
          This policy applies to everyone who uses {LEGAL.product}. It exists to keep the platform safe,
          lawful, and trusted. Breaching it may lead to suspension or termination.
        </p>
      </LegalSection>

      <LegalSection heading="You must not">
        <ul>
          <li>Use {LEGAL.product} for anything illegal, fraudulent, or harmful.</li>
          <li>Send messages without the required consent, or send spam over WhatsApp, Instagram, SMS, or email.</li>
          <li>Violate WhatsApp/Meta or Instagram platform policies (including opt-in, messaging-window, and template rules).</li>
          <li>Upload or transmit malware, or attempt to breach security, scrape, or overload the service.</li>
          <li>Infringe intellectual-property or privacy rights, or post unlawful, abusive, or deceptive content.</li>
          <li>Misrepresent the automated nature of AI messaging where disclosure is required.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Messaging consent &amp; anti-spam">
        <p>
          Tenants are responsible for obtaining and recording valid opt-in before messaging customers, for
          honoring opt-outs, and for complying with applicable anti-spam law. {LEGAL.product} may suspend
          messaging that risks platform or legal violations.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting &amp; enforcement">
        <p>
          Report violations to <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>. We may
          investigate, remove content (see <Link href="/ugc-policy">UGC Policy</Link>), and suspend accounts.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
