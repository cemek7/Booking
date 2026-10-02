export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';

/**
 * Deprecated. Settlement setup moved to /api/payments/subaccounts, which
 * verifies the bank account, forces a 0% subaccount split and records the
 * owner's fee acceptance. This route performs no Paystack call.
 */
export const POST = createHttpHandler(
  async () => NextResponse.json({
    success: false,
    code: 'ENDPOINT_DEPRECATED',
    error: 'Payment setup moved. Use Settings → Payments.',
    use: '/api/payments/subaccounts',
  }, { status: 410 }),
  'POST',
  { auth: true, roles: ['owner', 'superadmin'] }
);
