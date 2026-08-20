"use client";

import Link from 'next/link';
import BrandMark from '@/components/brand/BrandMark';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-[#f8f7f2] via-[#f5f2e8] to-[#f0ebdb] px-4">
      <div className="max-w-lg w-full rounded-[2rem] border border-[var(--brand-line)] bg-white/92 p-8 text-center shadow-[0_24px_80px_rgba(16,33,26,0.08)] space-y-5">
        <div className="mx-auto w-fit">
          <BrandMark variant="booka" className="h-12 shadow-sm shadow-emerald-600/20" />
        </div>
        <div className="text-4xl font-bold text-amber-600">401</div>
        <h1 className="text-2xl font-semibold text-[var(--brand-ink)]">Unauthorized</h1>
        <p className="text-sm leading-7 text-slate-600">
          You&apos;re not authorized to access this resource. Please sign in or contact your
          workspace owner if you think this is a mistake.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Link
            href="/booka/auth/signin"
            className="w-full rounded-full bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
          >
            Sign in
          </Link>
          <Link
            href="/booka/auth/onboarding"
            className="w-full rounded-full border border-[var(--brand-line)] bg-[#fcfbf7] px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:text-emerald-900"
          >
            Create a new workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
