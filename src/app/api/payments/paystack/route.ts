export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { processPaystackWebhook } from '@/lib/payments/paystackWebhookProcessor';

/** Legacy Paystack webhook URL. Identical behavior to /api/payments/webhook. */
export const POST = createHttpHandler(
  async (ctx) => {
    const rawBody = await ctx.request.text();
    const result = await processPaystackWebhook({ rawBody, signature: ctx.request.headers.get('x-paystack-signature') });
    return NextResponse.json(result.body, { status: result.status });
  },
  'POST',
  { auth: false },
);
