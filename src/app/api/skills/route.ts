export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const CreateSkillSchema = z.object({
  name: z.string().min(1, 'name is required'),
  category: z.string().optional(),
});

// GET /api/skills -> list skills
// POST /api/skills { name, category? } -> create skill

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('skills')
      .select('id,name,category,active,created_at')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    
    if (error) throw ApiErrorFactory.internalServerError(new Error('Failed to fetch skills'));
    
    return { skills: data || [] };
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const raw = await ctx.request.json();
    const parsed = CreateSkillSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message]));
      throw ApiErrorFactory.validationError(fields);
    }
    const name = parsed.data.name.trim();
    const category = parsed.data.category ? parsed.data.category.trim() : null;

    const { data, error } = await ctx.supabase
      .from('skills')
      .insert({
        tenant_id: tenantId,
        name,
        category
      })
      .select()
      .maybeSingle();
    
    if (error) throw ApiErrorFactory.internalServerError(new Error('Failed to create skill'));
    
    return { skill: data };
  },
  'POST',
  { auth: true }
);
