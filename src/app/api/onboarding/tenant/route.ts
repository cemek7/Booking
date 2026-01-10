import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/supabaseClient';
import { getSession } from '../../../../lib/auth/session';
import { z } from 'zod';
import { handleApiError } from '../../../../lib/error-handling';
import { createTenant } from '../../../../lib/services/onboarding-service';
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
 * Requires an authenticated user.
 */
export async function POST(req: NextRequest) {
  const span = tracer.startSpan('api.onboarding.tenant.post');
  try {
    const { session } = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    span.setAttribute('user.id', userId);

    const body = await req.json();
    const bodyValidation = OnboardingBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: bodyValidation.error.issues }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { tenantId } = await createTenant(supabase, userId, bodyValidation.data);

    span.setAttribute('tenant.id', tenantId);
    return NextResponse.json({ success: true, tenantId });
  } catch (error) {
    span.recordException(error as Error);
    return handleApiError(error, 'Failed to create tenant');
  } finally {
    span.end();
  }
}