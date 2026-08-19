import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'User-Generated Content Policy | Boka',
  description: 'Rules for reviews, messages, and other content submitted to Boka.',
};

export default function UgcPolicyPage() {
  return (
    <LegalDocument title="User-Generated Content Policy" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="What this covers">
        <p>
          This policy applies to content users submit to {LEGAL.product} — including reviews, ratings, and
          messages sent through WhatsApp or Instagram. You are responsible for the content you submit.
        </p>
      </LegalSection>

      <LegalSection heading="Content rules">
        <ul>
          <li>Be truthful. Do not post false, misleading, or fake reviews.</li>
          <li>No unlawful, defamatory, harassing, hateful, or obscene content.</li>
          <li>No content that infringes others&apos; intellectual-property or privacy rights.</li>
          <li>No spam, scams, or impersonation.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Moderation &amp; removal">
        <p>
          {LEGAL.product} and the relevant business may review, moderate, and remove content that breaches
          this policy or the <Link href="/acceptable-use">Acceptable Use Policy</Link>. We may also remove
          content in response to valid legal requests.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting &amp; takedown">
        <p>
          To report content or submit an intellectual-property/defamation notice, email{' '}
          <a href={`mailto:${LEGAL.legalEmail}`}>{LEGAL.legalEmail}</a> with the content location, the
          reason, and your contact details. We will review and act where appropriate.
        </p>
      </LegalSection>

      <LegalSection heading="Licence to display">
        <p>
          By submitting a review, you grant {LEGAL.company} and the relevant business a non-exclusive
          licence to display and distribute it in connection with the service. You can request removal of
          your own review at any time.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
