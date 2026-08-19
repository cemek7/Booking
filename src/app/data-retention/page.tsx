import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Data Retention | Boka',
  description: 'How long Boka keeps personal data and when it is deleted.',
};

export default function DataRetentionPage() {
  return (
    <LegalDocument title="Data Retention Schedule" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Principle">
        <p>
          {LEGAL.company} keeps personal data only as long as needed for the purpose it was collected,
          or as required by law, then deletes or anonymizes it. This page summarizes our default
          retention periods. It complements our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Retention by data type">
        <ul>
          <li><strong>Account data</strong> (tenant + staff): for the life of the account, deleted on closure subject to legal holds.</li>
          <li><strong>Bookings &amp; customer contact</strong>: retained while the relationship is active; anonymized on an erasure request (personal fields stripped, the booking record kept).</li>
          <li><strong>Messages</strong> (WhatsApp/Instagram): retained to run the AI front desk; deleted on erasure request.</li>
          <li><strong>Sales &amp; lead data</strong>: retained while the lead is active or being followed up; deleted or anonymized on an erasure request.</li>
          <li><strong>Order &amp; transaction records</strong>: retained for accounting/tax obligations (typically up to the period required by local law) with embedded personal data minimized.</li>
          <li><strong>Analytics &amp; logs</strong>: retained for a limited window for security and product improvement, then aggregated or purged.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Erasure &amp; the financial-records exception">
        <p>
          On a verified erasure request we anonymize or delete personal data across our systems. We
          <strong> keep transaction/booking records</strong> (with personal identifiers stripped) where
          retention is required for tax and accounting — this is a lawful exception to erasure, not a
          refusal to honour it. See how to make a request in our{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about retention: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
