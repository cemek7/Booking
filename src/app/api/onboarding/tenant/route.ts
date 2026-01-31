import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createTenant } from '@/lib/services/onboarding-service';
import { trace } from '@opentelemetry/api';

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
  business_type: z.string().optional(),
  timezone: z.string().optional(),
  services: z.array(ServiceSchema).optional(),
  staff: z.array(StaffSchema).optional(),
});

/**
 * POST /api/onboarding/tenant
 * Creates a new tenant and seeds initial data.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const span = tracer.startSpan('api.onboarding.tenant.post');

    try {
      if (!ctx.user?.id) {
        throw ApiErrorFactory.unauthorized('User ID required');
      }

      const userId = ctx.user.id;
      span.setAttribute('user.id', userId);

      const body = await ctx.request.json();
      const bodyValidation = OnboardingBodySchema.safeParse(body);

      if (!bodyValidation.success) {
        throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
      }

      const { tenantId } = await createTenant(ctx.supabase, userId, bodyValidation.data);

      span.setAttribute('tenant.id', tenantId);
      return { success: true, tenantId };
    } finally {
      span.end();
    }
  },
  'POST',
  { auth: true, requireTenantMembership: false }
);
