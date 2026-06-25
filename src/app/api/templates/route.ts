export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const TemplateBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().default(''),
  category: z.string().default('custom'),
  content: z.string().default(''),
  language: z.string().default('en'),
  active: z.boolean().default(true),
  variables: z.array(z.string()).default([]),
});

function rowToTemplate(row: Record<string, unknown>) {
  const m = (row.manifest ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    description: m.description ?? '',
    category: m.category ?? 'custom',
    content: m.content ?? '',
    variables: m.variables ?? [],
    language: m.language ?? 'en',
    active: m.active ?? true,
    usage_count: m.usage_count ?? 0,
    last_used: m.last_used ?? null,
    created_at: row.created_at,
    updated_at: m.updated_at ?? row.created_at,
  };
}

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('templates')
      .select('id, name, manifest, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { templates: (data ?? []).map(rowToTemplate) };
  },
  'GET',
  { auth: true },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const body = await ctx.request.json();
    const parsed = TemplateBodySchema.safeParse(body);
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);

    const now = new Date().toISOString();
    const { data, error } = await ctx.supabase
      .from('templates')
      .insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        name: parsed.data.name,
        manifest: {
          description: parsed.data.description,
          category: parsed.data.category,
          content: parsed.data.content,
          language: parsed.data.language,
          active: parsed.data.active,
          variables: parsed.data.variables,
          usage_count: 0,
          last_used: null,
          updated_at: now,
        },
        created_at: now,
      })
      .select('id, name, manifest, created_at')
      .single();

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { template: rowToTemplate(data) };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const { searchParams } = new URL(ctx.request.url);
    const id = searchParams.get('id');
    if (!id) throw ApiErrorFactory.badRequest('id query param required');

    const body = await ctx.request.json();
    const parsed = TemplateBodySchema.partial().safeParse(body);
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);

    const { data: existing, error: fetchError } = await ctx.supabase
      .from('templates')
      .select('name, manifest')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError) throw ApiErrorFactory.notFound('Template not found');

    const updatedManifest = {
      ...(existing.manifest ?? {}),
      ...parsed.data,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from('templates')
      .update({
        name: parsed.data.name ?? existing.name,
        manifest: updatedManifest,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, name, manifest, created_at')
      .single();

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { template: rowToTemplate(data) };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] },
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const { searchParams } = new URL(ctx.request.url);
    const id = searchParams.get('id');
    if (!id) throw ApiErrorFactory.badRequest('id query param required');

    const { error } = await ctx.supabase
      .from('templates')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] },
);
