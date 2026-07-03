import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Privacy Policy | Boka',
  description: 'How Boka collects, uses, and protects personal data.',
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Who we are">
        <p>
          {LEGAL.product} is {LEGAL.descriptor}, operated by {LEGAL.company} ({LEGAL.entity}).
          This policy explains how we handle personal data. We aim to comply with the EU/UK GDPR and
          the Nigeria Data Protection Act (NDPA). Contact us at{' '}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
        <p>
          {LEGAL.product} serves two groups: <strong>business customers ("tenants")</strong> who use the
          platform to run conversations, sell services and products, and take bookings, and the tenants&apos;{' '}
          <strong>end-customers</strong> who message, buy from, and book them. For an end-customer&apos;s data
          (conversations, orders, bookings), the tenant is the data controller and {LEGAL.product}{' '}
          acts as a processor under our <Link href="/dpa">Data Processing Agreement</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Data we collect">
        <ul>
          <li><strong>Account data:</strong> name, email, phone, business details, role.</li>
          <li><strong>Booking data:</strong> appointments, services, staff assignments, customer contact details.</li>
          <li><strong>Sales &amp; lead data:</strong> inquiries, product/service interest, lead status and follow-ups.</li>
          <li><strong>Order data:</strong> products purchased, quantities, amounts, and fulfilment details.</li>
          <li><strong>Messages:</strong> WhatsApp/Instagram conversations processed to run the AI front desk (answering, recommending, selling, booking).</li>
          <li><strong>Payment data:</strong> handled by our payment processors; we do not store full card numbers.</li>
          <li><strong>Usage &amp; device data:</strong> analytics events and error logs (analytics only with your consent).</li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use data and our legal bases">
        <ul>
          <li>To provide the service, process bookings, and fulfil product orders — performance of a contract.</li>
          <li>To operate AI messaging, sales conversations, lead capture, and reminders — legitimate interests / contract.</li>
          <li>To process payments for bookings and product purchases — contract and legal obligation.</li>
          <li>Product analytics and session replay — only with your <Link href="/cookies">consent</Link>.</li>
          <li>Security, fraud prevention, and error monitoring — legitimate interests.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="AI processing">
        <p>
          {LEGAL.product} uses automated AI to read and respond to customer messages — answering questions,
          recommending and selling services and products, capturing leads, and booking appointments.
          Customers are told they are speaking with an automated assistant and can reach a human. We do
          not use messages to make solely-automated decisions with legal or similarly significant effects
          without a human in the loop, and we do not send special-category (e.g. health) data to AI providers.
        </p>
      </LegalSection>

      <LegalSection heading="Sharing &amp; sub-processors">
        <p>
          We share data with vetted service providers who process it on our behalf. See the full{' '}
          <Link href="/sub-processors">sub-processor list</Link>. Where data leaves the EU/UK, we rely on
          appropriate safeguards such as Standard Contractual Clauses.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Subject to law, you may request access, correction, deletion, portability, restriction, and
          objection. You can request a <strong>data export or deletion</strong> by emailing{' '}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. We respond within 30 days.
          Some records (e.g. transaction history) may be retained where law requires.
        </p>
      </LegalSection>

      <LegalSection heading="Retention">
        <p>
          We keep personal data only as long as needed for the purposes above or as required by law, then
          delete or anonymize it.
        </p>
      </LegalSection>

      <LegalSection heading="International users &amp; representatives">
        <p>
          {LEGAL.product} is operated from outside the EU/UK. We have <strong>not currently appointed an
          Article 27 representative</strong>; we monitor EU/UK usage and will appoint one if it becomes
          required. EU/UK users may contact us at <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          {LEGAL.product} is not directed to children. Accounts require users to be at least 16 (or the age
          of digital consent in their country). See our <Link href="/terms">Terms</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Changes &amp; contact">
        <p>
          We will post updates here and revise the date above. Questions or complaints:{' '}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. You may also complain to your
          local data protection authority.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
