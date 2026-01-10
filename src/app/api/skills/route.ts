import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

// GET /api/skills -> list skills
// POST /api/skills { name, category? } -> create skill

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    const { data, error } = await ctx.supabase
      .from('skills')
      .select('id,name,category,active,created_at')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    
    if (error) throw ApiErrorFactory.internal('Failed to fetch skills');
    
    return { skills: data || [] };
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
    const name = (body?.name || '').trim();
    const category = body?.category ? String(body.category).trim() : null;
    
    if (!name) {
      throw ApiErrorFactory.badRequest('name is required');
    }
    
    const { data, error } = await ctx.supabase
      .from('skills')
      .insert({
        tenant_id: tenantId,
        name,
        category
      })
      .select()
      .maybeSingle();
    
    if (error) throw ApiErrorFactory.internal('Failed to create skill');
    
    return { skill: data };
  },
  'POST',
  { auth: true }
);
