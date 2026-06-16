"use client";

import { useSearchParams } from 'next/navigation';
import { FormSection } from './FormSection';

const STATUS_MESSAGES: Record<string, { text: string; tone: 'ok' | 'error' }> = {
  connected: { text: 'Instagram connected. Customer DMs will now flow into your inbox.', tone: 'ok' },
  denied: { text: 'Connection cancelled — you declined on the Instagram screen.', tone: 'error' },
  invalid_state: { text: 'Connection expired or could not be verified. Please try again.', tone: 'error' },
  missing_code: { text: 'Instagram did not return an authorization code. Please try again.', tone: 'error' },
  not_configured: { text: 'Instagram is not configured on this server yet. Contact support.', tone: 'error' },
  error: { text: 'Something went wrong connecting Instagram. Please try again.', tone: 'error' },
};

export function InstagramConnectSection() {
  const params = useSearchParams();
  const status = params.get('instagram');
  const banner = status ? STATUS_MESSAGES[status] : null;

  return (
    <FormSection
      title="Instagram DMs"
      description="Let customers start a booking from your Instagram DMs. Replies use the same AI front desk as WhatsApp."
    >
      {banner && (
        <div
          className={`mb-3 rounded border px-3 py-2 text-xs ${
            banner.tone === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}
        >
          {banner.text}
        </div>
      )}

      <p className="mb-3 text-xs text-gray-500">
        Instagram only allows replies within 24 hours of a customer&apos;s message, so it is
        best for capturing new enquiries — WhatsApp stays your channel for reminders and
        follow-ups. You connect your own Instagram professional account; nothing is shared
        across tenants.
      </p>

      <a
        href="/api/auth/instagram/start"
        className="inline-flex items-center rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
      >
        Connect Instagram
      </a>
    </FormSection>
  );
}
