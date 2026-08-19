import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/legal/LegalDocument';
import LegalSection from '@/components/legal/LegalSection';
import { LEGAL, SUB_PROCESSORS } from '@/lib/legal/constants';

export const metadata: Metadata = {
  title: 'Sub-processors | Boka',
  description: 'Third parties that process personal data on behalf of Boka.',
};

export default function SubProcessorsPage() {
  return (
    <LegalDocument title="Sub-processors" lastUpdated={LEGAL.lastUpdated}>
      <LegalSection heading="About this list">
        <p>
          {LEGAL.product} uses the third-party providers below to process personal data on our behalf. We
          require each to provide appropriate data-protection commitments. We update this page when the
          list changes; see our <Link href="/dpa">DPA</Link> for notification terms.
        </p>
      </LegalSection>

      <LegalSection heading="Current sub-processors">
        <div className="overflow-x-auto">
          <table className="mt-1 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#d8d4c6] text-left">
                <th className="py-2 pr-4 font-semibold">Provider</th>
                <th className="py-2 pr-4 font-semibold">Purpose</th>
                <th className="py-2 font-semibold">Region</th>
              </tr>
            </thead>
            <tbody>
              {SUB_PROCESSORS.map((sp) => (
                <tr key={sp.name} className="border-b border-[#e7e3d7] align-top">
                  <td className="py-2 pr-4 font-medium">{sp.name}</td>
                  <td className="py-2 pr-4">{sp.purpose}</td>
                  <td className="py-2">{sp.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection heading="Questions">
        <p>
          Contact <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
