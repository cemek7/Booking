import { createHttpHandler } from '../../../../lib/create-http-handler';
import EnhancedJobManager from '../../../../lib/enhancedJobManager';
import { z } from 'zod';

// Zod schema for POST request body
const ProcessDeadLetterBodySchema = z.object({
  action: z.enum(['delete', 'retry']),
  batch_size: z.number().int().min(1).max(100).default(50),
});

// Zod schema for GET request query params
const GetDeadLetterQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * POST /api/jobs/dead-letter
 * Processes jobs in the dead-letter queue (retry or delete).
 * Requires 'owner' role.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const body = await ctx.request.json();
    const bodyValidation = ProcessDeadLetterBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }
    const { action, batch_size } = bodyValidation.data;

    const jobManager = new EnhancedJobManager(ctx.supabase);

    const processResult = await jobManager.processDeadLetterQueue({
      manual_retry: action === 'retry',
      batch_size,
      tenant_id: tenantId,
    });

    return {
      success: true,
      action: action,
      requeued: processResult.requeued,
      deleted: processResult.deleted,
    };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);

/**
 * GET /api/jobs/dead-letter
 * Retrieves jobs from the dead-letter queue.
 * Requires 'owner' role.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const { searchParams } = new URL(ctx.request.url);
    const queryValidation = GetDeadLetterQuerySchema.safeParse(
      Object.fromEntries(searchParams)
    );

    if (!queryValidation.success) {
      throw new Error(`Invalid query parameters: ${JSON.stringify(queryValidation.error.issues)}`);
    }

    const { limit, offset } = queryValidation.data;

    const jobManager = new EnhancedJobManager(ctx.supabase);
    const { jobs, total } = await jobManager.getDeadLetterJobs({ limit, offset, tenant_id: tenantId });

    return {
      success: true,
      jobs,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);
    if (!queryValidation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: queryValidation.error.issues },
        { status: 400 }
      );
    }
    const { limit, offset } = queryValidation.data;

    const supabase = createServerSupabaseClient();
    const { data: deadLetterJobs, error, count } = await supabase
      .from('jobs')
      .select('*', { count: 'exact' })
      .eq('status', 'dead_letter')
      .eq('tenant_id', tenantId) // Tenant isolation
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    span.setAttributes({
      'dead_letter.count': count ?? 0,
      'tenant.id': tenantId,
    });

    return NextResponse.json({
      success: true,
      data: deadLetterJobs,
      count: count ?? 0,
    });
  } catch (error) {
    span.recordException(error as Error);
    return handleApiError(error, 'Failed to retrieve dead-letter jobs');
  } finally {
    span.end();
  }
}