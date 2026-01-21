import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const UpdateSkillSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().optional(),
});

/**
 * PATCH /api/skills/:id
 * Update a skill's name or category.
 */
export const PATCH = createHttpHandler(
  async (ctx) => {
    const skillId = ctx.params?.id;
    if (!skillId) {
      throw ApiErrorFactory.validationError({ id: 'Skill ID is required' });
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateSkillSchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    const patch: Record<string, unknown> = {};
    if (bodyValidation.data.name) patch.name = bodyValidation.data.name;
    if (bodyValidation.data.category !== undefined) patch.category = bodyValidation.data.category;

    if (Object.keys(patch).length === 0) {
      throw ApiErrorFactory.validationError({ body: 'Nothing to update' });
    }

    // Get skill to verify tenant access
    const { data: skillData, error: skillError } = await ctx.supabase
      .from('skills')
      .select('tenant_id')
      .eq('id', skillId)
      .maybeSingle();

    if (skillError || !skillData?.tenant_id) {
      throw ApiErrorFactory.notFound('Skill');
    }

    // Verify tenant access
    if (ctx.user?.tenantId && ctx.user.tenantId !== skillData.tenant_id) {
      throw ApiErrorFactory.forbidden('Access denied to this skill');
    }

    const { data, error } = await ctx.supabase
      .from('skills')
      .update(patch)
      .eq('id', skillId)
      .select()
      .maybeSingle();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { skill: data };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/skills/:id
 * Delete a skill.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const skillId = ctx.params?.id;
    if (!skillId) {
      throw ApiErrorFactory.validationError({ id: 'Skill ID is required' });
    }

    // Get skill to verify tenant access
    const { data: skillData, error: skillError } = await ctx.supabase
      .from('skills')
      .select('tenant_id')
      .eq('id', skillId)
      .maybeSingle();

    if (skillError || !skillData?.tenant_id) {
      throw ApiErrorFactory.notFound('Skill');
    }

    // Verify tenant access
    if (ctx.user?.tenantId && ctx.user.tenantId !== skillData.tenant_id) {
      throw ApiErrorFactory.forbidden('Access denied to this skill');
    }

    const { error } = await ctx.supabase
      .from('skills')
      .delete()
      .eq('id', skillId);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { ok: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
