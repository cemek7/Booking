import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Terms of Service | Boka',
  description: 'Terms for businesses using Boka and for customers booking through it.',
};

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Overview">
        <p>
          These Terms govern use of {LEGAL.product}. Part A applies to <strong>business customers
          ("tenants")</strong> who subscribe to {LEGAL.product}. Part B applies to <strong>end-customers</strong>{' '}
          who book or message a tenant through the platform. By using {LEGAL.product} you agree to the
          applicable part.
        </p>
      </LegalSection>

      <LegalSection heading="Part A — Business (tenant) terms" id="tenant">
        <ul>
          <li><strong>Account &amp; eligibility:</strong> you must provide accurate details and be authorized to bind your business.</li>
          <li><strong>Subscription &amp; billing:</strong> fees, billing cycle, and renewal are shown at purchase. Subscriptions auto-renew until cancelled; you can cancel self-serve at any time and retain access until the end of the paid period.</li>
          <li><strong>AI credits:</strong> AI usage is paid from a prepaid credit wallet. Credits are <strong>prepaid, non-refundable for cash</strong>, usable only for {LEGAL.product} AI usage, and expire per the rules shown in your billing settings.</li>
          <li><strong>Selling services &amp; products:</strong> you may sell your own services and products through {LEGAL.product}. You set and are responsible for prices, descriptions, availability/stock, and the accuracy of your listings.</li>
          <li><strong>Your responsibilities (merchant of record):</strong> you are the merchant of record for all payments your customers make through {LEGAL.product} — bookings and product purchases. You are responsible for delivering services, fulfilling and shipping product orders, honoring your own cancellation/refund/return terms, product quality and any warranties, complying with consumer-protection law (including distance-selling / right-to-return rules where they apply), handling customer disputes and chargebacks, and collecting/remitting applicable taxes. {LEGAL.product} only facilitates the payment to your account.</li>
          <li><strong>Data:</strong> you are the data controller for your customers&apos; data; {LEGAL.product} processes it under our <Link href="/dpa">DPA</Link>.</li>
          <li><strong>Acceptable use:</strong> you must follow our <Link href="/acceptable-use">Acceptable Use Policy</Link>, including messaging-consent and anti-spam rules.</li>
          <li><strong>Termination:</strong> either party may terminate per these Terms; we may suspend for non-payment or policy violations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Part B — Customer terms (bookings & purchases)" id="customer">
        <ul>
          <li><strong>Bookings &amp; purchases:</strong> when you book or buy through {LEGAL.product}, your contract for that service, appointment, or product is with the <strong>business you are dealing with</strong>, not with {LEGAL.product}. {LEGAL.product} provides the AI front-desk technology (conversations, sales, and booking).</li>
          <li><strong>Payments:</strong> any deposit, booking fee, or product payment is collected on behalf of the business through our payment processors. <strong>Refunds, cancellations, and product returns are handled by the business</strong> per its policy. See <Link href="/refunds">Refunds &amp; Cancellations</Link>.</li>
          <li><strong>Automated messaging:</strong> you may interact with an automated AI assistant and can ask to reach a human. Standard messaging rates may apply.</li>
          <li><strong>Your content:</strong> reviews and messages you submit are subject to our <Link href="/ugc-policy">UGC Policy</Link>.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Disclaimers &amp; liability">
        <p>
          {LEGAL.product} is provided "as is." To the extent permitted by law, {LEGAL.company} is not liable
          for the acts or omissions of tenants or their service delivery, and our aggregate liability is
          limited as set out in the applicable order or subscription agreement.
        </p>
      </LegalSection>

      <LegalSection heading="Changes &amp; contact">
        <p>
          We may update these Terms and will revise the date above. Questions:{' '}
          <a href={`mailto:${LEGAL.legalEmail}`}>{LEGAL.legalEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
