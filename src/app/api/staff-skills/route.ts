export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const AssignSkillSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  skill_id: z.string().min(1, 'skill_id is required'),
  proficiency: z.number().int().min(1).max(5).optional().default(1),
});

// GET /api/staff-skills?user_id=optional -> list assignments
// POST /api/staff-skills { user_id, skill_id } -> assign skill

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const url = new URL(ctx.request.url);
    const userId = url.searchParams.get('user_id');
    
    let query = ctx.supabase
      .from('staff_skills')
      .select('user_id,skill_id,skill_name,proficiency')
      .eq('tenant_id', tenantId);
    
    if (userId) query = query.eq('user_id', userId);
    
    const { data, error } = await query;
    if (error) throw ApiErrorFactory.databaseError(error);
    
    return { assignments: data || [] };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const raw = await ctx.request.json();
    const parsed = AssignSkillSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const { user_id: userId, skill_id: skillId, proficiency } = parsed.data;
    
    // Verify skill exists
    const { data: skill, error: skillError } = await ctx.supabase
      .from('skills')
      .select('id,name')
      .eq('id', skillId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    if (skillError || !skill) throw ApiErrorFactory.notFound('Skill not found');
    
    // Assign skill
    const { data, error } = await ctx.supabase
      .from('staff_skills')
      .upsert({
        tenant_id: tenantId,
        user_id: userId,
        skill_id: skillId,
        skill_name: skill.name,
        proficiency
      })
      .select()
      .maybeSingle();
    
    if (error) throw ApiErrorFactory.databaseError(error);
    
    return { assignment: data };
  },
  'POST',
  { auth: true }
);
