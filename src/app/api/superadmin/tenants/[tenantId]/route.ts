export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { topUpTenantWallet } from '@/lib/billing/ai-wallet';

type TenantPatchBody = {
  status?: 'active' | 'suspended' | 'inactive';
  plan?: string;
  low_balance_threshold_credits?: number;
  wallet_topup_credits?: number;
  wallet_topup_reference?: string;
  wallet_topup_description?: string;
};

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenantId is required');
    }

    const body = (await ctx.request.json().catch(() => ({}))) as TenantPatchBody;
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

    const { data: tenant } = await admin
      .from('tenants')
      .select('id, name, status, plan, created_at, updated_at, settings')
      .eq('id', tenantId)
      .maybeSingle();

    return {
      tenant,
      wallet: walletResult,
    };
  },
  'PATCH',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
