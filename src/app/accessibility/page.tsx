import type { Metadata } from 'next';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Accessibility Statement | Boka',
  description: 'Boka\'s commitment to accessible, inclusive booking experiences.',
};

export default function AccessibilityPage() {
  return (
    <LegalDocument title="Accessibility Statement" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="Our commitment">
        <p>
          {LEGAL.company} aims to make {LEGAL.product} usable by everyone, including people who rely
          on assistive technologies. We target conformance with the{' '}
          <a href="https://www.w3.org/TR/WCAG21/" rel="noopener noreferrer" target="_blank">
            Web Content Accessibility Guidelines (WCAG) 2.1, Level AA
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="What we do">
        <ul>
          <li>Use semantic HTML and labelled controls so screen readers can navigate the app.</li>
          <li>Support keyboard navigation for core booking and messaging flows.</li>
          <li>Aim for sufficient colour contrast and resizable text.</li>
          <li>Provide text alternatives for meaningful non-text content.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Known limitations">
        <p>
          We are actively improving accessibility and have not yet completed a full third-party audit.
          Some older screens and third-party embedded components (e.g. payment widgets) may not fully
          conform. We prioritise fixes on the public booking flow first.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting a problem">
        <p>
          If you encounter an accessibility barrier, please tell us — include the page and what
          happened — at <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>. We aim to
          respond within a few business days and will offer an alternative way to complete your task
          where possible.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
