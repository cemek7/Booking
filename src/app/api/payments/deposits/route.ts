import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';

interface DepositRequest {
  amount: number;
  currency?: string;
  email: string;
  reservationId: string;
  provider?: 'paystack' | 'stripe';
}

export const POST = createHttpHandler(
  async (ctx) => {
    const body: DepositRequest = await ctx.request.json();
    const { amount, currency = 'NGN', email, reservationId, provider = 'paystack' } = body;

    // Validation
    if (!amount || !email || !reservationId) {
      throw ApiErrorFactory.missingRequiredField('amount, email, reservationId');
    }

    if (amount <= 0) {
      throw ApiErrorFactory.validationError({ amount: 'must be greater than 0' });
    }

    // Get tenant info
    const { data: tenantUser } = await ctx.supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', ctx.user!.id)
      .single();

    if (!tenantUser) {
      throw ApiErrorFactory.notFound('Tenant');
    }

    // Verify reservation exists and belongs to tenant
    const { data: reservation } = await ctx.supabase
      .from('reservations')
      .select('id, status')
      .eq('id', reservationId)
      .eq('tenant_id', tenantUser.tenant_id)
      .single();

    if (!reservation) {
      throw ApiErrorFactory.notFound('Reservation');
    }

    if (reservation.status === 'cancelled') {
      throw ApiErrorFactory.validationError({ reservation: 'Cannot create deposit for cancelled reservation' });
    }

    // Check for existing deposit (idempotency)
    const { data: existingDeposit } = await ctx.supabase
      .from('transactions')
      .select('id, status, provider_reference, raw')
      .eq('tenant_id', tenantUser.tenant_id)
      .eq('raw->reservation_id', reservationId)
      .eq('type', 'deposit')
      .in('status', ['pending', 'success'])
      .single();

    if (existingDeposit) {
      return {
        success: true,
        transactionId: existingDeposit.id,
        authorizationUrl: existingDeposit.raw?.provider_response?.authorizationUrl,
        message: 'Deposit already exists for this reservation',
        duplicate: true,
      };
    }

    const paymentService = new PaymentService(ctx.supabase);
    const result = await paymentService.initializePayment({
      tenantId: tenantUser.tenant_id,
      amount,
      currency,
      email,
      reservationId,
      provider,
      metadata: {
        type: 'deposit',
        reservation_id: reservationId,
      },
    });

    if (!result.success) {
      throw ApiErrorFactory.databaseError(new Error(result.error || 'Deposit initialization failed'));
    }

    return {
      success: true,
      transactionId: result.transactionId,
      authorizationUrl: result.authorizationUrl,
      message: 'Deposit initialized successfully',
    };
  },
  'POST',
  { auth: true }
);