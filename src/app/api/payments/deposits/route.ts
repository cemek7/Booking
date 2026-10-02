export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler, getVerifiedTenantId, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { initializeTenantPayment } from '@/lib/payments/tenantSettlement';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const DepositSchema = z.object({
  amountMinor: z.number().int().positive(),
  email: z.string().trim().email(),
  reservationId: z.string().uuid(),
}).strict();

const CONFIGURATION_CODES = ['SETTLEMENT_DISABLED', 'SETTLEMENT_NOT_CONFIGURED', 'POLICY_NOT_ACCEPTED'];

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = DepositSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }
    const { amountMinor, email, reservationId } = parsed.data;
    const tenantId = getVerifiedTenantId(ctx);

    const { data: reservation } = await ctx.supabase
      .from('reservations')
      .select('id, status')
      .eq('id', reservationId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!reservation) throw ApiErrorFactory.notFound('Reservation');
    if (reservation.status === 'cancelled') {
      throw ApiErrorFactory.validationError({ reservation: 'Cannot create deposit for cancelled reservation' });
    }

    const result = await initializeTenantPayment({
      tenantId,
      amountMinor,
      currency: 'NGN',
      customerEmail: email,
      subject: { type: 'reservation', id: reservationId },
      idempotencyKey: `deposit:${reservationId}`,
      metadata: { type: 'deposit', source: 'dashboard' },
    });

    if (!result.ok) {
      const configuration = CONFIGURATION_CODES.includes(result.code);
      return NextResponse.json({
        success: false,
        code: result.code,
        error: configuration ? 'Payments are not set up yet. Finish setup in Settings → Payments.' : result.message,
      }, { status: configuration || result.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 502 });
    }

    await recordFrontDeskEvent({
      tenantId,
      eventType: 'payment_requested',
      eventCategory: 'payment',
      channel: 'dashboard',
      actorRole: 'owner',
      actorId: ctx.user!.id,
      reservationId,
      correlationId: result.transactionId,
      amount: amountMinor / 100,
      currency: 'NGN',
      statusTo: 'initiated',
      metadata: { provider: 'paystack', payment_type: 'deposit', authorization_url: result.authorizationUrl },
    });

    return {
      success: true,
      transactionId: result.transactionId,
      authorizationUrl: result.authorizationUrl,
      duplicate: result.reused,
    };
  },
  'POST',
  { auth: true, permissions: [BOOKA_PERMISSIONS.RECORD_PAYMENTS] }
);
