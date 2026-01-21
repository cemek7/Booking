import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

const UpdateSettingsSchema = z.object({
  name: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  preferred_llm_model: z.string().trim().optional(),
  llm_token_rate: z.union([z.number(), z.string(), z.null()]).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

/**
 * GET /api/admin/tenant/[id]/settings
 * Retrieve tenant settings (name, timezone, LLM preferences).
 * Public endpoint - no auth required.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.id;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ id: 'Tenant ID is required' });
    }

    const { data: row, error } = await ctx.supabase
      .from('tenants')
      .select('id, name, timezone, preferred_llm_model, llm_token_rate')
      .eq('id', tenantId)
      .maybeSingle();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { row: row ?? null };
  },
  'GET',
  { auth: false }
);

/**
 * PUT /api/admin/tenant/[id]/settings
 * Update tenant settings (owner-only).
 */
export const PUT = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.id;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ id: 'Tenant ID is required' });
    }

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const body = await ctx.request.json();
    const bodyValidation = UpdateSettingsSchema.safeParse(body);
    if (!bodyValidation.success) {
      throw ApiErrorFactory.validationError({ issues: bodyValidation.error.issues });
    }

    // Normalize values
    const payload: Record<string, unknown> = {};
    const data = bodyValidation.data;

    if (data.name !== undefined) payload.name = data.name;
    if (data.timezone !== undefined) payload.timezone = data.timezone;
    if (data.preferred_llm_model !== undefined) payload.preferred_llm_model = data.preferred_llm_model;
    if (data.llm_token_rate !== undefined) {
      payload.llm_token_rate = data.llm_token_rate === '' || data.llm_token_rate === null
        ? null
        : Number(data.llm_token_rate);
    }

    const { data: updated, error } = await ctx.supabase
      .from('tenants')
      .update(payload)
      .eq('id', tenantId)
      .select()
      .maybeSingle();

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }

    return { success: true, row: updated ?? null };
  },
  'PUT',
  { auth: true, roles: ['owner'] }
);

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, PUT, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
