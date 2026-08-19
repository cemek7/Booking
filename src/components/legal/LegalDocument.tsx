import React from 'react';
import Link from 'next/link';

export default function LegalDocument({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f6f5ef] text-[#10211a]">
      <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6">
        <Link href="/" className="text-sm text-[#3a4a43] underline">
          ← Back to home
        </Link>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-[#3a4a43]">Last updated: {lastUpdated}</p>

        <div
          role="note"
          className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <strong>Draft — pending legal review.</strong> This document is provided for
          transparency and is being finalized. It is not yet a substitute for advice from
          qualified counsel.
        </div>

        <article className="mt-8">{children}</article>
      </div>
    </main>
  );
}
