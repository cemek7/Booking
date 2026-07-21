export const dynamic = 'force-dynamic';
/**
 * Public Booking Routes - No Authentication Required
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';
import type { RouteContext } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * Helper to get tenant by slug
 */
async function getTenantBySlug(ctx: RouteContext, slug: string) {
  const supabase = createSupabaseAdminClient();
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (tenantErr) {
    throw ApiErrorFactory.databaseError(new Error(tenantErr.message));
  }

  if (!tenant) {
    throw ApiErrorFactory.notFound('Tenant');
  }

  return tenant;
}

/**
 * GET /api/public/[slug]/services
 * Get services for public booking
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;

    if (!slug || typeof slug !== 'string') {
      throw ApiErrorFactory.badRequest('Slug required');
    }

    const tenant = await getTenantBySlug(ctx, slug);

    const services = await publicBookingService.getTenantServices(tenant.id);
    return services;
  },
  'GET',
  { auth: false }
);
