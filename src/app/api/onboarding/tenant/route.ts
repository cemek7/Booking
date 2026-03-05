import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createTenant } from '@/lib/services/onboarding-service';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';

const tracer = trace.getTracer('boka-onboarding-api');

const ServiceSchema = z.object({
  name: z.string().min(1),
  duration: z.number().int().positive().optional(),
  price: z.number().positive().optional(),
  category: z.string().optional(),
});

const StaffSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['owner', 'staff']).optional(),
  status: z.enum(['active', 'on_leave']).optional(),
});

const OnboardingBodySchema = z.object({
  name: z.string().min(1, 'Tenant name is required'),
  industry: z.string().optional(),
  business_type: z.string().optional(),
  timezone: z.string().optional(),
  description: z.string().optional(),
  services: z.array(ServiceSchema).optional(),
  staff: z.array(StaffSchema).optional(),
});

const _authenticatedPOST = createHttpHandler(
  async (ctx) => {
    const span = tracer.startSpan('api.onboarding.tenant.post');
    try {
      if (!ctx.user?.id) {
        throw ApiErrorFactory.missingAuthorization();
      }

      const userId = ctx.user.id;
      span.setAttribute('user.id', userId);

      const body = await ctx.request.json();
      const bodyValidation = OnboardingBodySchema.safeParse(body);

      if (!bodyValidation.success) {
        throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
      }

      const { tenantId, tenantSlug } = await createTenant(ctx.supabase, userId, bodyValidation.data);

      span.setAttribute('tenant.id', tenantId);
      return { success: true, tenantId, tenantSlug };
    } finally {
      span.end();
    }
  },
  'POST',
  { auth: true, requireTenantMembership: false }
);

/**
 * POST /api/onboarding/tenant
 * Creates a new tenant and seeds initial data.
 * Returns a dev fallback (ok: true, devFallback: true) when Supabase env vars are not configured,
 * so integration tests and local dev without a DB still work.
 */
export async function POST(request: Request): Promise<Response> {
  // Dev / CI fallback: bypass auth when Supabase env vars are absent (non-production only)
  if (
    process.env.NODE_ENV !== 'production' &&
    (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    const devTenantId = randomUUID();
    return new Response(
      JSON.stringify({ ok: true, devFallback: true, tenantId: devTenantId, slug: `dev-${devTenantId.slice(0, 6)}` }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return _authenticatedPOST(request as NextRequest);
}
