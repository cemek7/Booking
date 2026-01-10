import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

// GET /api/staff-skills?user_id=optional -> list assignments
// POST /api/staff-skills { user_id, skill_id } -> assign skill

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const url = new URL(ctx.request.url);
    const userId = url.searchParams.get('user_id');
    
    let query = ctx.supabase
      .from('staff_skills')
      .select('user_id,skill_id,skill_name,proficiency')
      .eq('tenant_id', tenantId);
    
    if (userId) query = query.eq('user_id', userId);
    
    const { data, error } = await query;
    if (error) throw ApiErrorFactory.internal('Failed to fetch staff skills');
    
    return { assignments: data || [] };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const body = await ctx.request.json();
    const userId = body?.user_id;
    const skillId = body?.skill_id;
    const proficiency = typeof body?.proficiency === 'number' ? body.proficiency : 1;
    
    if (!userId || !skillId) {
      throw ApiErrorFactory.badRequest('user_id and skill_id required');
    }
    
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
    
    if (error) throw ApiErrorFactory.internal('Failed to assign skill');
    
    return { assignment: data };
  },
  'POST',
  { auth: true }
);
