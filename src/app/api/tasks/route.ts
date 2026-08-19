export const dynamic = 'force-dynamic';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  due_date: z.string().optional(),
});

const UpdateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  due_date: z.string().nullable().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('id, title, description, priority, status, due_date, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { tasks: data ?? [] };
  },
  'GET',
  { auth: true },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const body = await ctx.request.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);

    const { data, error } = await ctx.supabase
      .from('tasks')
      .insert({
        tenant_id: tenantId,
        created_by: ctx.user?.id ?? null,
        ...parsed.data,
      })
      .select('id, title, description, priority, status, due_date, created_at, updated_at')
      .single();

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { task: data };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const body = await ctx.request.json();
    const parsed = UpdateTaskSchema.safeParse(body);
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);

    const { id, ...updates } = parsed.data;

    const { data, error } = await ctx.supabase
      .from('tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, title, description, priority, status, due_date, created_at, updated_at')
      .single();

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { task: data };
  },
  'PATCH',
  { auth: true },
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const { searchParams } = new URL(ctx.request.url);
    const id = searchParams.get('id');
    if (!id) throw ApiErrorFactory.badRequest('id query param required');

    const { error } = await ctx.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw ApiErrorFactory.internalServerError(new Error(error.message));

    return { success: true };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] },
);
