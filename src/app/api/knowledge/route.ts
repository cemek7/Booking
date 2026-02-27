import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const ArticleSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  category: z.string().max(100).default('general'),
  tags: z.array(z.string().max(50)).max(20).default([]),
});

/**
 * GET /api/knowledge
 * List knowledge articles for the authenticated tenant.
 * Requires auth (role: owner, manager).
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const { data, error } = await ctx.supabase
      .from('tenant_knowledge_articles')
      .select('id, title, category, tags, is_active, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/knowledge] GET error:', error.message);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch knowledge articles'));
    }

    return { articles: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * POST /api/knowledge
 * Create a knowledge article for the tenant (used by the AI for RAG retrieval).
 * Body: { title, content, category?, tags? }
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const body = await ctx.request.json();
    const parsed = ArticleSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const { title, content, category, tags } = parsed.data;

    const { data, error } = await ctx.supabase
      .from('tenant_knowledge_articles')
      .insert({ tenant_id: tenantId, title, content, category, tags })
      .select('id, title, category, tags, is_active, created_at')
      .single();

    if (error) {
      console.error('[api/knowledge] POST error:', error.message);
      throw ApiErrorFactory.internalServerError(new Error('Failed to create knowledge article'));
    }

    return { article: data };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * DELETE /api/knowledge?id=<uuid>
 * Soft-delete (deactivate) a knowledge article.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const url = new URL(ctx.request.url);
    const id = url.searchParams.get('id');
    if (!id) throw ApiErrorFactory.validationError({ id: 'Article ID required' });

    const { error } = await ctx.supabase
      .from('tenant_knowledge_articles')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[api/knowledge] DELETE error:', error.message);
      throw ApiErrorFactory.internalServerError(new Error('Failed to deactivate knowledge article'));
    }

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);
