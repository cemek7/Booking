/**
 * Manager Schedule Management API
 * 
 * Provides manager-level scheduling operations including staff schedule management,
 * availability coordination, and scheduling optimization for team operations
 */
import { createHttpHandler } from '../../../../lib/create-http-handler';
import { z } from 'zod';
import {
  getTeamSchedule,
  createScheduleOverride,
  updateStaffAvailability,
  bulkUpdateSchedules,
} from '../../../../lib/services/manager-schedule-service';

const GetScheduleQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  staffId: z.string().optional(),
  view: z.enum(['week', 'day', 'month']).default('week'),
});

const ScheduleActionSchema = z.enum([
  'create-override',
  'update-availability',
  'bulk-update',
]);

const PostScheduleBodySchema = z.object({
  action: ScheduleActionSchema,
  data: z.any(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const queryValidation = GetScheduleQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryValidation.success) {
      throw new Error(`Invalid query parameters: ${JSON.stringify(queryValidation.error.issues)}`);
    }
    const { startDate, endDate, staffId } = queryValidation.data;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const scheduleData = await getTeamSchedule(ctx.supabase, ctx.user.tenantId, { start, end }, staffId);
    return { success: true, ...scheduleData };
  },
  'GET',
  { auth: true, roles: ['manager', 'owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = PostScheduleBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }
    const { action, data } = bodyValidation.data;

    let result;
    switch (action) {
      case 'create-override':
        result = await createScheduleOverride(ctx.supabase, ctx.user.tenantId, data);
        break;
      case 'update-availability':
        result = await updateStaffAvailability(ctx.supabase, ctx.user.tenantId, data);
        break;
      case 'bulk-update':
        result = await bulkUpdateSchedules(ctx.supabase, ctx.user.tenantId, data);
        break;
      default:
        throw new Error('Invalid schedule action');
    }

    return { success: true, ...result };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner'] }
);
  try {
    const { session, tenantId } = await getSession(request);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId, ['manager', 'owner']);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
