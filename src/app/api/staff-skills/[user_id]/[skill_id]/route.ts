import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * DELETE /api/staff-skills/:user_id/:skill_id
 * Unassign a skill from a staff member.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const userId = ctx.params?.user_id;
    const skillId = ctx.params?.skill_id;

    if (!userId || !skillId) {
      throw ApiErrorFactory.validationError({ params: 'user_id and skill_id are required' });
    }

    // Get staff skill to find tenant_id and verify it exists
    const { data: skillAssignment, error: fetchError } = await ctx.supabase
      .from('staff_skills')
      .select('tenant_id')
      .eq('user_id', userId)
      .eq('skill_id', skillId)
      .maybeSingle();

    if (fetchError) {
      throw ApiErrorFactory.databaseError(fetchError);
    }

    if (!skillAssignment?.tenant_id) {
      throw ApiErrorFactory.notFound('Skill assignment');
    }

    // Verify tenant access
    if (ctx.user?.tenantId && ctx.user.tenantId !== skillAssignment.tenant_id) {
      throw ApiErrorFactory.forbidden('Access denied to this skill assignment');
    }

    const { error } = await ctx.supabase
      .from('staff_skills')
      .delete()
      .eq('user_id', userId)
      .eq('skill_id', skillId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { ok: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
