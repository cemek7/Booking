export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { topUpTenantWallet } from '@/lib/billing/ai-wallet';
import { enterOffboarding } from '@/lib/offboarding/offboardService';
import { z } from 'zod';

type TenantPatchBody = {
  status?: 'active' | 'suspended' | 'inactive';
  plan?: string;
  low_balance_threshold_credits?: number;
  velocity_credits_override?: number | null;
  wallet_topup_credits?: number;
  wallet_topup_reference?: string;
  wallet_topup_description?: string;
  offboard?: { reason: 'non_payment' | 'gdpr_erasure' | 'superadmin' };
};

const TenantPatchSchema = z.object({
  status: z.enum(['active', 'suspended', 'inactive']).optional(),
  plan: z.string().optional(),
  low_balance_threshold_credits: z.number().finite().optional(),
  velocity_credits_override: z.number().finite().nullable().optional(),
  wallet_topup_credits: z.number().positive().optional(),
  wallet_topup_reference: z.string().optional(),
  wallet_topup_description: z.string().optional(),
  offboard: z.object({
    reason: z.enum(['non_payment', 'gdpr_erasure', 'superadmin']),
  }).optional(),
});

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenantId is required');
    }

    const parsed = TenantPatchSchema.safeParse(await ctx.request.json().catch(() => ({})));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }
    const body = parsed.data as TenantPatchBody;
    const admin = createSupabaseAdminClient();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.status) updates.status = body.status;
    if (body.plan) updates.plan = body.plan;

    const threshold = typeof body.low_balance_threshold_credits === 'number' && Number.isFinite(body.low_balance_threshold_credits)
      ? body.low_balance_threshold_credits
      : null;
    if (threshold != null) {
      updates.settings = {
        ...(await admin.from('tenants').select('settings').eq('id', tenantId).maybeSingle()).data?.settings || {},
        low_balance_threshold_credits: threshold,
      };
    }

    if (Object.keys(updates).length > 1) {
      const { error } = await admin.from('tenants').update(updates).eq('id', tenantId);
      if (error) throw error;
    }

    if (body.velocity_credits_override !== undefined) {
      const velocity = body.velocity_credits_override === null
        ? null
        : Number(body.velocity_credits_override);
      const { error } = await admin
        .from('ai_wallets')
        .upsert({
          tenant_id: tenantId,
          velocity_credits_override: velocity,
        }, { onConflict: 'tenant_id' });
      if (error) throw error;
    }

    let walletResult: { allowed: boolean; balance_credits?: number; reason?: string } | null = null;
    if (typeof body.wallet_topup_credits === 'number' && body.wallet_topup_credits > 0) {
      walletResult = await topUpTenantWallet(
        admin,
        tenantId,
        body.wallet_topup_credits,
        body.wallet_topup_description || 'Superadmin top-up',
        body.wallet_topup_reference || undefined
      );
      if (!walletResult.allowed) {
        throw ApiErrorFactory.databaseError(new Error(walletResult.reason || 'Failed to top up wallet'));
      }
    }

    let offboardResult: { lifecycleState: string } | null = null;
    if (body.offboard?.reason) {
      offboardResult = await enterOffboarding(admin, {
        tenantId,
        reason: body.offboard.reason,
        actorUserId: ctx.user!.id,
        actorRole: 'superadmin',
      });
    }

    const [{ data: tenant }, { data: wallet }] = await Promise.all([
      admin
        .from('tenants')
        .select('id, name, status, plan, created_at, updated_at, settings')
        .eq('id', tenantId)
        .maybeSingle(),
      admin
        .from('ai_wallets')
        .select('velocity_credits_override')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ]);

    return {
      tenant: tenant
        ? {
            ...tenant,
            velocity_credits_override: wallet?.velocity_credits_override ?? null,
          }
        : null,
      wallet: walletResult,
      offboard: offboardResult,
    };
  },
  'PATCH',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
