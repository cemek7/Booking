export const dynamic = 'force-dynamic';
/**
 * Public Storefront — catalogue. No authentication required.
 * GET /api/public/[slug]/products
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import publicStorefrontService from '@/lib/publicStorefrontService';

async function getTenantIdBySlug(slug: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw ApiErrorFactory.databaseError(new Error(error.message));
  if (!tenant) throw ApiErrorFactory.notFound('Tenant');
  return tenant.id as string;
}

export const GET = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;
    if (!slug || typeof slug !== 'string') {
      throw ApiErrorFactory.badRequest('Slug required');
    }
    const tenantId = await getTenantIdBySlug(slug);
    const products = await publicStorefrontService.getTenantProducts(tenantId);
    return products;
  },
  'GET',
  { auth: false }
);
