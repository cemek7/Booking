export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { requireAuth } from '@/lib/auth/server-auth';
import OwnerLLMMetrics from '@/components/OwnerLLMMetrics.client';

export const metadata: Metadata = {
  title: 'AI Metrics | Booka',
  description: 'Your AI front desk usage and cost',
};

export default async function OwnerLLMMetricsPage() {
  // Owner-only; the client fetches usage scoped to the owner's tenant.
  await requireAuth(['owner']);

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">AI metrics</h1>
        <p className="mt-1 text-sm text-slate-500">
          See how hard your AI front desk is working across bookings, sales, and customer conversations — and what it costs.
        </p>
      </div>
      <OwnerLLMMetrics />
    </div>
  );
}
