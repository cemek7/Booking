'use client';

import { useMemo, useState } from 'react';
import { estimateSolarSavings } from '@/showcase/lib/estimator';

export function SolarEstimator() {
  const [monthlyBill, setMonthlyBill] = useState(100000);
  const [propertyType, setPropertyType] = useState<'residential' | 'commercial'>('residential');
  const estimate = useMemo(() => estimateSolarSavings({ monthlyBillNaira: Math.max(0, monthlyBill), propertyType }), [monthlyBill, propertyType]);

  return (
    <section aria-labelledby="estimator-title" className="sc-surface rounded-2xl border border-current/10 p-6 shadow-2xl shadow-black/10 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--sc-accent)' }}>Illustrative planning tool</p>
      <h2 id="estimator-title" className="sc-display mt-3 text-2xl font-semibold">Start with your current energy bill.</h2>
      <p className="mt-2 text-sm opacity-70">This is not a quote or a performance guarantee. A site assessment is required before any system is designed.</p>
      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium">Monthly electricity spend (₦)
          <input className="mt-2 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2.5" min="0" step="5000" type="number" value={monthlyBill} onChange={(event) => setMonthlyBill(Number(event.target.value))} />
        </label>
        <label className="text-sm font-medium">Property type
          <select className="mt-2 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2.5" value={propertyType} onChange={(event) => setPropertyType(event.target.value as 'residential' | 'commercial')}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </label>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Metric label="Indicative system" value={`${estimate.systemSizeKw} kW`} />
        <Metric label="Illustrative monthly offset" value={`₦${estimate.estimatedMonthlySavingsNaira.toLocaleString()}`} />
        <Metric label="Illustrative payback" value={`${estimate.paybackYears} years`} />
      </div>
      <details className="mt-6 text-sm opacity-75"><summary className="cursor-pointer font-medium">View calculation assumptions</summary><ul className="mt-3 list-disc space-y-2 pl-5">{estimate.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></details>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-current/10 p-4"><p className="text-xs uppercase tracking-wider opacity-60">{label}</p><p className="sc-display mt-2 text-xl font-semibold">{value}</p></div>;
}
