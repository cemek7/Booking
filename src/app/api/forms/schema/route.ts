export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { FormSchemaGenerator } from '@/lib/forms/formSchemaGenerator';

/**
 * GET /api/forms/schema?vertical=beauty&serviceType=haircut&includePayment=true&requireDeposit=false
 *
 * Returns a JSON form schema for the booking flow, scoped to a vertical and service type.
 * Used by client-side form renderers to dynamically build booking forms.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const vertical = url.searchParams.get('vertical') || 'general';
    const serviceType = url.searchParams.get('serviceType') || undefined;
    const includePayment = url.searchParams.get('includePayment') === 'true';
    const requireDeposit = url.searchParams.get('requireDeposit') === 'true';

    const schema = FormSchemaGenerator.forBooking(vertical as any, serviceType as any, {
      includePayment,
      requireDeposit,
    } as any);

    return { schema };
  },
  'GET',
  { auth: false }
);
