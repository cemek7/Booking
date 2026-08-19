export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { renameTenantBrand } from '@/lib/whatsapp/v2/tenantBrand';
import { CAPS } from '@/lib/billing/spendCaps/config';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const nullableNumberField = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.union([z.number(), z.null()]));

const UpdateSettingsSchema = z.object({
  name: z.string().trim().optional(),
  display_name: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  preferred_llm_model: z.string().trim().optional(),
  llm_token_rate: nullableNumberField.optional(),
  daily_budget_credits: nullableNumberField.optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

/**
 * GET /api/admin/tenant/[id]/settings
 * Retrieve tenant settings (name, timezone, LLM preferences).
 * Requires authentication; caller must belong to the requested tenant (or be a superadmin).
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.id;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ id: 'Tenant ID is required' });
    }
    const admin = createSupabaseAdminClient();

    // Verify the caller has access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const [{ data: row, error }, { data: wallet, error: walletError }] = await Promise.all([
      ctx.supabase
        .from('tenants')
        .select('id, name, timezone, preferred_llm_model, llm_token_rate, lifecycle_state, scheduled_purge_at')
        .eq('id', tenantId)
        .maybeSingle(),
      admin
        .from('ai_wallets')
        .select('daily_budget_credits')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ]);

    if (error) {
      throw ApiErrorFactory.databaseError(error);
    }
    if (walletError && walletError.code !== 'PGRST116') {
      throw ApiErrorFactory.databaseError(walletError);
    }

    return {
      row: row
        ? {
            ...row,
            daily_budget_credits: wallet?.daily_budget_credits ?? null,
          }
        : null,
    };
  },
  'GET',
  { auth: true }
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
    const admin = createSupabaseAdminClient();

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
      payload.llm_token_rate = data.llm_token_rate;
    }
    const walletPayload: Record<string, unknown> = {};
    if (data.daily_budget_credits !== undefined) {
      if (data.daily_budget_credits === null) {
        walletPayload.daily_budget_credits = null;
      } else {
        walletPayload.daily_budget_credits = CAPS.resolveDailyBudget(data.daily_budget_credits);
      }
    }

    // `display_name` is owned by renameTenantBrand (below), never `payload`.
    let updated: unknown = null;
    if (Object.keys(payload).length > 0) {
      const { data: updatedRow, error } = await ctx.supabase
        .from('tenants')
        .update(payload)
        .eq('id', tenantId)
        .select()
        .maybeSingle();

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }
      updated = updatedRow;
    }

    if (Object.keys(walletPayload).length > 0) {
      const { error } = await admin
        .from('ai_wallets')
        .upsert({
          tenant_id: tenantId,
          ...walletPayload,
        }, { onConflict: 'tenant_id' });

      if (error) {
        throw ApiErrorFactory.databaseError(error);
      }
    }

    // Customer-facing rename goes through the brand helper so previous_names
    // and renamed_at are recorded (drift "formerly" support). Do NOT route this
    // through `payload` — that would skip the bookkeeping.
    if (data.display_name !== undefined) {
      await renameTenantBrand(tenantId, data.display_name);
    }

    const { data: walletRow, error: walletError } = await admin
      .from('ai_wallets')
      .select('daily_budget_credits')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (walletError && walletError.code !== 'PGRST116') {
      throw ApiErrorFactory.databaseError(walletError);
    }

    return {
      success: true,
      row: updated
        ? {
            ...(updated as Record<string, unknown>),
            daily_budget_credits: walletRow?.daily_budget_credits ?? null,
          }
        : {
            daily_budget_credits: walletRow?.daily_budget_credits ?? null,
          },
    };
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
