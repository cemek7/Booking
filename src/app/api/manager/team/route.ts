/**
 * Manager Team Management API
 * 
 * Provides manager-level team operations including staff management,
 * role assignments, and team coordination functionality
 */
import { createHttpHandler } from '../../../../lib/create-http-handler';
import { z } from 'zod';
import {
  getTeamData,
  inviteTeamMember,
  updateTeamMemberRole,
  setTeamMemberActiveStatus,
} from '../../../../lib/services/manager-team-service';

const TeamActionSchema = z.enum([
  'invite-member',
  'update-role',
  'set-active-status',
]);

const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.string(),
  full_name: z.string().optional(),
});

const UpdateRoleSchema = z.object({
  memberId: z.string().uuid(),
  newRole: z.string(),
});

const SetActiveStatusSchema = z.object({
  memberId: z.string().uuid(),
  isActive: z.boolean(),
});

const PostTeamBodySchema = z.object({
  action: TeamActionSchema,
  data: z.any(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const teamData = await getTeamData(ctx.supabase, ctx.user.tenantId);
    return { success: true, ...teamData };
  },
  'GET',
  { auth: true, roles: ['manager', 'owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = PostTeamBodySchema.safeParse(body);

    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }
    const { action, data } = bodyValidation.data;

    let result;
    switch (action) {
      case 'invite-member':
        const inviteData = InviteMemberSchema.parse(data);
        result = await inviteTeamMember(ctx.supabase, ctx.user.tenantId, inviteData);
        break;
      case 'update-role':
        const roleData = UpdateRoleSchema.parse(data);
        result = await updateTeamMemberRole(ctx.supabase, ctx.user.tenantId, roleData.memberId, roleData.newRole);
        break;
      case 'set-active-status':
        const statusData = SetActiveStatusSchema.parse(data);
        result = await setTeamMemberActiveStatus(ctx.supabase, ctx.user.tenantId, statusData.memberId, statusData.isActive);
        break;
      default:
        throw new Error('Invalid team action');
    }

    return { success: true, ...result };
  },
  'POST',
  { auth: true, roles: ['manager', 'owner'] }
);