/**
 * Public Booking Routes - No Authentication Required
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';

/**
 * GET /api/public/[slug]
 * Get public tenant info (header, logo, description)
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;

    if (!slug || typeof slug !== 'string') {
      throw ApiErrorFactory.badRequest('Slug required');
    }

    const tenantInfo = await publicBookingService.getTenantPublicInfo(slug);
    return tenantInfo;
  },
  'GET',
  { auth: false }
);
