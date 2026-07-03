import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Refunds & Cancellations | Boka',
  description: 'How refunds and cancellations work on Boka.',
};

export default function RefundsPage() {
  return (
    <LegalDocument title="Refunds & Cancellations" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Bookings paid to a business">
        <p>
          When you pay a deposit or fee for a booking, that payment is collected on behalf of the
          <strong> business you booked</strong>, which is the merchant of record. <strong>Refunds and
          cancellations for bookings are governed by that business&apos;s own policy.</strong> {LEGAL.product}{' '}
          facilitates the payment but does not set or fund these refunds. Please contact the business
          directly; we can help route your request if needed.
        </p>
      </LegalSection>

      <LegalSection heading="Products purchased from a business">
        <p>
          When you buy a product through {LEGAL.product}, your purchase is from the <strong>business you
          bought from</strong>, which is the merchant of record. <strong>Returns, exchanges, and refunds
          for products are governed by that business&apos;s own returns policy</strong> and by any consumer
          rights you have under local law (for example, distance-selling / right-to-return rules).
          {LEGAL.product} facilitates the payment but does not set or fund product refunds. Contact the
          business directly; we can help route your request.
        </p>
      </LegalSection>

      <LegalSection heading="Business (tenant) subscriptions">
        <p>
          Subscription fees for {LEGAL.product} are billed per the cycle shown at purchase. You can cancel
          self-serve at any time and keep access until the end of the paid period. Unless required by law,
          subscription fees already paid are non-refundable.
        </p>
      </LegalSection>

      <LegalSection heading="AI credits">
        <p>
          AI credits are <strong>prepaid and non-refundable for cash</strong>. They can be used only for
          {LEGAL.product} AI usage and expire per the rules shown in billing settings.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about platform billing: <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>.
          See also our <Link href="/terms">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
