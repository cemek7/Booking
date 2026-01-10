import { createHttpHandler } from '../../../lib/create-http-handler';
import EnhancedJobManager from '../../../lib/enhancedJobManager';
import { z } from 'zod';

// Zod schema for POST request body
const ScheduleJobBodySchema = z.object({
  name: z.string().min(1, 'Job name is required'),
  payload: z.record(z.any()),
  priority: z.number().int().min(1).max(10).default(5).optional(),
  scheduled_at: z.string().datetime().optional(),
  retry_policy: z.object({
    max_retries: z.number().int().min(0).optional(),
    base_delay_ms: z.number().int().min(100).optional(),
    backoff_multiplier: z.number().min(1).optional(),
    max_delay_ms: z.number().int().optional(),
    jitter: z.boolean().optional(),
  }).optional(),
  timeout_ms: z.number().int().min(1000).optional(),
});

/**
 * POST /api/jobs
 * Schedules a new background job.
 * Requires 'staff' or higher role.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const body = await ctx.request.json();
    const bodyValidation = ScheduleJobBodySchema.safeParse(body);
    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }
    const { name, payload, ...options } = bodyValidation.data;

    const jobManager = new EnhancedJobManager(ctx.supabase);

    const result = await jobManager.scheduleJob(name, payload, {
      tenant_id: tenantId,
      ...options,
      scheduled_at: options.scheduled_at ? new Date(options.scheduled_at) : undefined,
    });

    if (!result.success || !result.job_id) {
      throw new Error(result.error || 'Failed to schedule job.');
    }

    return { success: true, job_id: result.job_id };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

/**
 * GET /api/jobs
 * Retrieves statistics about the job queue.
 * Requires 'owner' role.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const jobManager = new EnhancedJobManager(ctx.supabase);
    const stats = await jobManager.getJobStats();
    return { success: true, stats };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);

  } catch (error) {
    span.recordException(error as Error);
    return handleApiError(error, 'Failed to retrieve job stats');
  } finally {
    span.end();
  }
}