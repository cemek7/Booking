export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { getTenantPublicInfo } from '@/lib/publicBookingService';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

interface ConfirmationPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}

export const metadata = { title: 'Order confirmation' };

/**
 * Paystack returns the customer here after checkout (callback_url) with a
 * ?reference=…. We show a friendly confirmation and reflect the payment status
 * if the webhook has already reconciled the transaction — but never block on it
 * (the webhook is the source of truth; this page is just reassurance).
 */
export default async function StorefrontConfirmation({ params, searchParams }: ConfirmationPageProps) {
  const { slug } = await params;
  const { reference, trxref } = await searchParams;
  const ref = reference || trxref || null;

  let tenantName = 'the shop';
  try {
    const tenant = await getTenantPublicInfo(slug);
    tenantName = tenant.name;
  } catch { /* fall back to generic copy */ }

  let paid = false;
  if (ref) {
    try {
      const { data } = await createSupabaseAdminClient()
        .from('transactions')
        .select('status')
        .eq('provider_reference', ref)
        .maybeSingle();
      const status = (data as { status?: string } | null)?.status;
      paid = status === 'success' || status === 'paid' || status === 'completed';
    } catch { /* status unknown — show the neutral thank-you */ }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <div className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
        {paid ? '✓' : '⏳'}
      </div>
      <h1 className="mt-5 text-2xl font-bold text-slate-900">
        {paid ? 'Payment received' : 'Thank you for your order'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {paid
          ? `${tenantName} has received your payment and will prepare your order. You'll be contacted on WhatsApp with delivery details.`
          : `${tenantName} has received your order. If your payment is still processing it will confirm shortly — no need to pay again.`}
      </p>
      {ref && <p className="mt-6 text-xs text-slate-400">Payment reference: {ref}</p>}
      <Link href={`/store/${slug}`} className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">
        Back to shop
      </Link>
    </div>
  );
}
