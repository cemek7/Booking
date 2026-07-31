export const dynamic = 'force-dynamic';
/**
 * Public Storefront — order intake. No authentication required.
 * POST /api/public/[slug]/order
 */

import { z } from 'zod';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import publicStorefrontService from '@/lib/publicStorefrontService';

const OrderSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1, 'Add at least one product'),
  customer_name: z.string().trim().min(1, 'Name is required').max(120),
  customer_phone: z.string().trim().min(3, 'Phone is required').max(32),
  customer_email: z.string().trim().email().optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional(),
});

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

export const POST = createHttpHandler(
  async (ctx) => {
    const slug = ctx.params?.slug;
    if (!slug || typeof slug !== 'string') {
      throw ApiErrorFactory.badRequest('Slug required');
    }

    const parsed = OrderSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }

    const tenantId = await getTenantIdBySlug(slug);

    // After paying on Paystack, return the customer to the storefront's
    // confirmation page (Paystack appends ?reference=… to this URL).
    let callbackUrl: string | null = null;
    try {
      callbackUrl = new URL(`/store/${slug}/confirmation`, ctx.request.url).toString();
    } catch { /* origin unavailable — order still created, just no auto-redirect */ }

    const result = await publicStorefrontService.createPublicOrder(
      tenantId,
      {
        items: parsed.data.items,
        customer_name: parsed.data.customer_name,
        customer_phone: parsed.data.customer_phone,
        customer_email: parsed.data.customer_email || undefined,
        notes: parsed.data.notes,
      },
      { callbackUrl }
    );

    return { success: true, ...result };
  },
  'POST',
  { auth: false }
);
