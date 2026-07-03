import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Data Processing Agreement | Boka',
  description: 'Data Processing Agreement between Boka and its business customers.',
};

export default function DpaPage() {
  return (
    <LegalDocument title="Data Processing Agreement (DPA)" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Roles">
        <p>
          This DPA applies where a business customer ("tenant") uses {LEGAL.product} to process personal
          data of its own customers. The <strong>tenant is the data controller</strong> and {LEGAL.company}{' '}
          is the <strong>processor</strong>, acting on the tenant&apos;s documented instructions.
        </p>
      </LegalSection>

      <LegalSection heading="Scope of processing">
        <ul>
          <li><strong>Subject matter:</strong> providing the {LEGAL.product} AI front-desk service — customer conversations, sales and lead capture, product orders, and bookings.</li>
          <li><strong>Duration:</strong> for the term of the tenant&apos;s subscription.</li>
          <li><strong>Data subjects:</strong> the tenant&apos;s customers and staff.</li>
          <li><strong>Data types:</strong> contact details, conversation/message content, sales and lead data, product orders and purchase history, bookings, and related metadata. Tenants must not submit special-category data (e.g. health) unless separately agreed in writing.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Our obligations">
        <ul>
          <li>Process only on the controller&apos;s instructions and applicable law.</li>
          <li>Ensure personnel are bound by confidentiality.</li>
          <li>Apply appropriate technical and organizational security measures.</li>
          <li>Assist with data-subject requests and with security, breach, and impact-assessment duties.</li>
          <li>Notify the controller without undue delay after becoming aware of a personal-data breach.</li>
          <li>Delete or return personal data at the end of the service, subject to legal retention.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Sub-processors">
        <p>
          The controller authorizes {LEGAL.company} to use the sub-processors listed at{' '}
          <Link href="/sub-processors">/sub-processors</Link>. We impose data-protection terms on each and
          remain responsible for their performance. We will give notice of intended changes so the
          controller can object.
        </p>
      </LegalSection>

      <LegalSection heading="International transfers">
        <p>
          Where personal data is transferred outside the EEA/UK, the parties rely on appropriate safeguards
          such as the Standard Contractual Clauses (and the UK Addendum/IDTA where relevant).
        </p>
      </LegalSection>

      <LegalSection heading="How to execute">
        <p>
          To countersign this DPA for your organization, contact{' '}
          <a href={`mailto:${LEGAL.legalEmail}`}>{LEGAL.legalEmail}</a>. This page reflects our standard
          terms and will be superseded by any signed agreement between the parties.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
