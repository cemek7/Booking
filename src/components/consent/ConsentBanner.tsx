// src/components/consent/ConsentBanner.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { getConsent, setConsent } from '@/lib/consent/consentStore';
import Link from 'next/link';

export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only state (localStorage/URL) after hydration; doing it during render would desync server and client HTML
    setVisible(getConsent() === null);
  }, []);

  if (!visible) return null;

  const decide = (analytics: boolean) => {
    setConsent(analytics);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-50 m-4 rounded-lg border bg-white p-4 shadow-lg md:max-w-md md:left-auto"
    >
      <p className="text-sm text-gray-700">
        We use essential cookies to run Boka. With your consent we also use analytics
        cookies to improve the product. See our{' '}
        <Link href="/cookies" className="underline">Cookie Policy</Link>.
      </p>
      <div className="mt-3 flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => decide(false)}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Reject non-essential
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}
