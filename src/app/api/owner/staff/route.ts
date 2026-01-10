import { createHttpHandler } from '../../../../lib/create-http-handler';
import { z } from 'zod';
import {
  getStaffData,
  inviteStaffMember,
  updateStaffMember,
  removeStaffMember,
} from '../../../../lib/services/owner-staff-service';

const StaffActionSchema = z.enum(['invite', 'update', 'remove']);
const UserRoleSchema = z.enum(['owner', 'manager', 'staff', 'customer']);

const InviteStaffSchema = z.object({
  email: z.string().email(),
  role: UserRoleSchema,
  fullName: z.string().optional(),
});

const UpdateStaffSchema = z.object({
  staffId: z.string().uuid(),
  role: UserRoleSchema.optional(),
  active: z.boolean().optional(),
});

const RemoveStaffSchema = z.object({
  staffId: z.string().uuid(),
});

const PostStaffBodySchema = z.object({
  action: StaffActionSchema,
  data: z.any(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const staffData = await getStaffData(ctx.supabase, ctx.user.tenantId);
    return { success: true, ...staffData };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = PostStaffBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }
    const { action, data } = bodyValidation.data;

    let result;
    switch (action) {
      case 'invite':
        const inviteData = InviteStaffSchema.parse(data);
        result = await inviteStaffMember(ctx.supabase, ctx.user.tenantId, inviteData);
        break;
      case 'update':
        const updateData = UpdateStaffSchema.parse(data);
        result = await updateStaffMember(ctx.supabase, ctx.user.tenantId, updateData.staffId, updateData);
        break;
      case 'remove':
        const removeData = RemoveStaffSchema.parse(data);
        result = await removeStaffMember(ctx.supabase, ctx.user.tenantId, removeData.staffId);
        break;
      default:
        throw new Error('Invalid staff action');
    }

    return { success: true, ...result };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);