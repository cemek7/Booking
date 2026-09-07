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
    const serviceType = url.searchParams.get('serviceType') || '';
    const requireDeposit = url.searchParams.get('requireDeposit') === 'true';

    if (vertical !== 'beauty' && vertical !== 'hospitality' && vertical !== 'medicine') {
      throw ApiErrorFactory.validationError({ vertical: 'beauty, hospitality, or medicine is required' });
    }

    const schema = FormSchemaGenerator.forBooking(vertical, serviceType, {
      requireDeposit,
    });

    return { schema };
  },
  'GET',
  { auth: false }
);
