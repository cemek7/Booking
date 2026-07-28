export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createOrResumeTenant } from '@/lib/services/onboarding-service';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { captureServerAnalyticsEvent } from '@/lib/analytics/server';

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

function isValidIANATimezone(tz: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

const OnboardingBodySchema = z.object({
  name: z.string().min(1, 'Tenant name is required'),
  industry: z.string().optional(),
  business_type: z.string().optional(),
  timezone: z.string().optional().refine(
    (tz) => !tz || isValidIANATimezone(tz),
    { message: 'Invalid timezone — use IANA format (e.g. Africa/Lagos)' }
  ),
  description: z.string().optional(),
  services: z.array(ServiceSchema).optional(),
  staff: z.array(StaffSchema).optional(),
  // Explicit opt-in to create an additional workspace for a user who already
  // owns one. The default onboarding flow omits it, so re-running onboarding
  // resumes the existing tenant instead of silently creating a duplicate.
  allowAdditional: z.boolean().optional(),
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

      // Use admin client to bypass RLS for tenant + membership creation.
      // The user is not yet a tenant member, so the bearer client cannot INSERT into tenant_users.
      const adminClient = createSupabaseAdminClient();
      const { tenantId, slug: tenantSlug, resumed } = await createOrResumeTenant(
        adminClient,
        userId,
        bodyValidation.data,
        { allowAdditional: bodyValidation.data.allowAdditional }
      );

      span.setAttribute('tenant.id', tenantId);
      span.setAttribute('tenant.resumed', resumed);

      // Only fire the "onboarding started" analytics + paystack-pending flag for a
      // freshly created tenant. A resumed tenant already emitted these on creation.
      if (!resumed) {
        await captureServerAnalyticsEvent({
          event: ANALYTICS_EVENTS.TENANT_ONBOARDING_STARTED,
          properties: {
            tenant_id: tenantId,
            business_category: bodyValidation.data.industry ?? bodyValidation.data.business_type ?? null,
            flow: 'activation',
            channel: 'web',
            staff_count: bodyValidation.data.staff?.length ?? 0,
            metadata: {
              tenant_slug: tenantSlug,
              services_count: bodyValidation.data.services?.length ?? 0,
              staff_count: bodyValidation.data.staff?.length ?? 0,
            },
          },
          distinctId: userId,
        });

        // Non-blocking: flag paystack subaccount setup as pending (bank details collected later).
        // Merge into existing metadata rather than clobbering the whole jsonb.
        void (async () => {
          try {
            const { data: existing } = await ctx.supabase
              .from('tenants')
              .select('metadata')
              .eq('id', tenantId)
              .maybeSingle();
            const currentMeta = (existing?.metadata && typeof existing.metadata === 'object')
              ? (existing.metadata as Record<string, unknown>)
              : {};
            await ctx.supabase
              .from('tenants')
              .update({ metadata: { ...currentMeta, paystack_subaccount_pending: true } })
              .eq('id', tenantId);
            defaultLogger.info('[onboarding] Paystack subaccount flagged pending', { tenantId });
          } catch (err) {
            defaultLogger.warn('[onboarding] Failed to flag paystack subaccount pending', { tenantId, err });
          }
        })();
      }

      return { success: true, tenantId, tenantSlug, resumed };
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
    (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    const devTenantId = randomUUID();
    return new Response(
      JSON.stringify({ ok: true, devFallback: true, tenantId: devTenantId, slug: `dev-${devTenantId.slice(0, 6)}` }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return _authenticatedPOST(request as NextRequest);
}
