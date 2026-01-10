import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { ensureOwnerForTenant, isGlobalAdmin } from '@/types/unified-permissions';

/**
 * POST /api/jobs/create-recurring
 * 
 * Create a recurring job with specified interval. Validates RBAC:
 * - If payload includes tenant_id: actor must be tenant owner or global admin
 * - If no tenant_id: actor must be global admin
 * 
 * Request body: { type, payload, interval_minutes, scheduled_at? }
 */

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const { type, payload, interval_minutes, scheduled_at } = await ctx.request.json();

    // Validate required fields
    if (!type) throw ApiErrorFactory.badRequest('Missing job type');
    if (!payload) throw ApiErrorFactory.badRequest('Missing payload');
    if (!interval_minutes || Number(interval_minutes) <= 0) {
      throw ApiErrorFactory.badRequest('Invalid interval_minutes');
    }

    // Verify actor is owner or global admin for this tenant
    try {
      await ensureOwnerForTenant(ctx.supabase, ctx.user!.id, tenantId);
    } catch (e) {
      // Not owner — check global admin
      const isAdmin = await isGlobalAdmin(ctx.supabase, ctx.user!.id, ctx.user!.email);
      if (!isAdmin) throw ApiErrorFactory.insufficientPermissions(['owner', 'admin']);
    }

    // Attach recurring metadata to payload
    const jobPayload = { ...payload, _recurring: { interval_minutes: Number(interval_minutes) }, tenant_id: tenantId };
    const now = new Date().toISOString();
    const scheduled = scheduled_at ?? now;

    // Insert recurring job
    const { data, error } = await ctx.supabase
      .from('jobs')
      .insert([{
        type,
        payload: jobPayload,
        attempts: 0,
        status: 'pending',
        scheduled_at: scheduled,
        run_count: 0,
        created_at: now,
        updated_at: now,
      }])
      .select()
      .maybeSingle();

    if (error) throw ApiErrorFactory.internal('Failed to create recurring job');

    return { data };
  },
  'POST',
  { auth: true }
);
      ])
      .select()
      .maybeSingle();

    if (insertError) {
      console.error('[api/jobs/create-recurring] Error creating recurring job:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ job: jobData });
  } catch (err: unknown) {
    console.error('[api/jobs/create-recurring] error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
