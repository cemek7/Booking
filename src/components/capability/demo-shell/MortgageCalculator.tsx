'use client';

import { useState } from 'react';
import { estimateMonthlyPayment } from '@/showcase/lib/haven-mortgage';

const naira = (n: number) => `₦${n.toLocaleString()}`;

export function MortgageCalculator({ defaultPrincipal = 180_000_000 }: { defaultPrincipal?: number }) {
  const [principal, setPrincipal] = useState(defaultPrincipal);
  const [ratePct, setRatePct] = useState(24);
  const [years, setYears] = useState(20);

  const result = estimateMonthlyPayment({ principal, ratePct, years });
  const inputClass = 'mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm';

  return (
    <div className="sc-surface rounded-2xl border border-current/10 p-6">
      <h3 className="sc-display text-xl font-semibold">Illustrative repayment estimate</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--sc-muted)' }}>
        A demonstrator tool — not a mortgage offer or financial advice.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Price (₦)
          <input type="number" min={0} step={1_000_000} className={inputClass} value={principal} onChange={(e) => setPrincipal(Math.max(0, Number(e.target.value)))} />
        </label>
        <label className="text-sm font-medium">
          Rate (% / yr)
          <input type="number" min={0} max={100} step={0.5} className={inputClass} value={ratePct} onChange={(e) => setRatePct(Math.max(0, Number(e.target.value)))} />
        </label>
        <label className="text-sm font-medium">
          Term (years)
          <input type="number" min={1} max={40} step={1} className={inputClass} value={years} onChange={(e) => setYears(Math.max(1, Number(e.target.value)))} />
        </label>
      </div>
      <dl className="mt-6 grid gap-4 sm:grid-cols-3" role="status">
        <div><dt className="text-xs uppercase tracking-[.14em]" style={{ color: 'var(--sc-muted)' }}>Est. monthly</dt><dd className="sc-display mt-1 text-2xl font-semibold" style={{ color: 'var(--sc-primary)' }}>{naira(result.monthlyPaymentNaira)}</dd></div>
        <div><dt className="text-xs uppercase tracking-[.14em]" style={{ color: 'var(--sc-muted)' }}>Total repayment</dt><dd className="mt-1 text-lg font-medium">{naira(result.totalRepaymentNaira)}</dd></div>
        <div><dt className="text-xs uppercase tracking-[.14em]" style={{ color: 'var(--sc-muted)' }}>Total interest</dt><dd className="mt-1 text-lg font-medium">{naira(result.totalInterestNaira)}</dd></div>
      </dl>
      <ul className="mt-5 space-y-1 text-xs" style={{ color: 'var(--sc-muted)' }}>
        {result.assumptions.map((a) => <li key={a}>• {a}</li>)}
      </ul>
    </div>
  );
}
