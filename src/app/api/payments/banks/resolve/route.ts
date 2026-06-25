export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { resolveBankAccount } from '@/lib/paystack';

/** GET /api/payments/banks/resolve?accountNumber=0123456789&bankCode=044 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const accountNumber = url.searchParams.get('accountNumber');
    const bankCode = url.searchParams.get('bankCode');

    if (!accountNumber || !bankCode) {
      throw ApiErrorFactory.badRequest('accountNumber, bankCode');
    }

    const result = await resolveBankAccount(accountNumber, bankCode);
    if (!result.success) {
      throw ApiErrorFactory.validationError({ accountNumber: result.error || 'Could not resolve account' });
    }

    return {
      success: true,
      accountName: result.account!.accountName,
      accountNumber: result.account!.accountNumber,
    };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);
