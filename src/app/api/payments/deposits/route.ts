export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import PaymentService from '@/lib/paymentService';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

interface DepositRequest {
  amount: number;
  currency?: string;
  email: string;
  reservationId: string;
  provider?: 'paystack' | 'stripe' | 'flutterwave';
}

type TenantMetadata = {
  paystack_subaccount_code?: string;
};

export const POST = createHttpHandler(
  async (ctx) => {
    const body: DepositRequest = await ctx.request.json();
    const { amount, currency = 'NGN', email, reservationId, provider = 'paystack' } = body;

    // Validation
    if (!amount || !email || !reservationId) {
      throw ApiErrorFactory.badRequest('amount, email, reservationId' );
    }

    if (amount <= 0) {
      throw ApiErrorFactory.validationError({ amount: 'must be greater than 0' });
    }

    // Enforce reasonable bounds: minimum 1 unit, maximum 10,000,000 (e.g. 100,000 NGN in kobo)
    const MAX_AMOUNT = 10_000_000;
    if (amount > MAX_AMOUNT) {
      throw ApiErrorFactory.validationError({ amount: `must not exceed ${MAX_AMOUNT}` });
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

    // Look up tenant's Paystack subaccount (for split-payment settlement)
    let subaccountCode: string | undefined;
    if (provider === 'paystack') {
      const { data: tenant } = await ctx.supabase
        .from('tenants')
        .select('metadata')
        .eq('id', tenantUser.tenant_id)
        .single();
      subaccountCode = (tenant?.metadata as TenantMetadata | null)?.paystack_subaccount_code ?? undefined;
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
      subaccountCode,
      bearer: 'account',
    });

    if (!result.success) {
      throw ApiErrorFactory.databaseError(new Error(result.error || 'Deposit initialization failed'));
    }

    await recordFrontDeskEvent({
      tenantId: tenantUser.tenant_id,
      eventType: 'payment_requested',
      eventCategory: 'payment',
      channel: 'dashboard',
      actorRole: 'owner',
      actorId: ctx.user!.id,
      reservationId,
      correlationId: result.transactionId,
      amount,
      currency,
      statusTo: 'initiated',
      metadata: {
        provider,
        payment_type: 'deposit',
        authorization_url: result.authorizationUrl ?? null,
      },
    });

    return {
      success: true,
      transactionId: result.transactionId,
      authorizationUrl: result.authorizationUrl,
      message: 'Deposit initialized successfully',
    };
  },
  'POST',
  { auth: true, permissions: [BOOKA_PERMISSIONS.RECORD_PAYMENTS] }
);
