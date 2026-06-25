export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { listBanks } from '@/lib/paystack';

/** GET /api/payments/banks?country=nigeria — list supported banks */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const country = url.searchParams.get('country') || 'nigeria';

    const result = await listBanks(country);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json(
      { banks: result.banks },
      { headers: { 'Cache-Control': 'public, max-age=600' } }
    );
  },
  'GET',
  { auth: true }
);
