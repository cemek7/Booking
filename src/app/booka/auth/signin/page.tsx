export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';
import AuthMagicLinkForm from '@/components/AuthMagicLinkForm';

export default function BookaSignInPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-[#f8f7f2] via-[#f5f2e8] to-[#f0ebdb] px-4 py-10">
      <main className="mx-auto w-full max-w-5xl">
        <div className="mb-10 flex items-start justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark variant="techclave" className="h-12 w-12 shadow-sm shadow-[#10211a]/15" />
            <div>
              <p className="brand-kicker text-[#597061]">Techclave</p>
              <p className="mt-1 text-sm text-slate-500">Products for front-desk operations</p>
            </div>
          </Link>

          <Link
            href="/booka"
            className="rounded-full border border-[var(--brand-line)] bg-white/80 px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-900"
          >
            View Booka
          </Link>
        </div>

        <div className="mb-8 max-w-2xl">
          <p className="brand-kicker text-[#597061]">Booka sign in</p>
          <h1 className="techclave-display mt-4 text-5xl text-[#101717] sm:text-6xl">Welcome back</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#5a625f]">
            Sign in with a magic link to continue into Booka, your AI front desk for WhatsApp and Instagram beauty enquiries.
          </p>
        </div>

        <AuthMagicLinkForm mode="signin" />
      </main>
    </div>
  );
}
