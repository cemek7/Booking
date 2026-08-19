export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type WalletRow = {
  tenant_id: string;
  balance_credits?: number | string | null;
  lifetime_topups_credits?: number | string | null;
  lifetime_spent_credits?: number | string | null;
  low_balance_threshold_credits?: number | string | null;
};

type LedgerRow = {
  tenant_id: string;
  kind: 'topup' | 'reservation' | 'usage' | 'refund' | 'adjustment';
  amount_credits?: number | string | null;
  created_at?: string | null;
};

function deriveTenantStatus(params: {
  balanceCredits: number;
  lowBalanceThresholdCredits: number;
  hasRecentLedgerActivity: boolean;
}): 'active' | 'inactive' | 'low_balance' {
  if (params.balanceCredits > 0 && params.balanceCredits <= params.lowBalanceThresholdCredits) {
    return 'low_balance';
  }

  if (params.hasRecentLedgerActivity || params.balanceCredits > 0) {
    return 'active';
  }

  return 'inactive';
}

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status') || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '10')));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const admin = createSupabaseAdminClient();

    const { data: tenants, error } = await admin
      .from('tenants')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const tenantIds = (tenants || []).map((tenant: { id: string }) => tenant.id);
    const [walletsRes, ledgerRes] = await Promise.all([
      tenantIds.length
        ? admin
            .from('ai_wallets')
            .select('tenant_id, balance_credits, lifetime_topups_credits, lifetime_spent_credits, low_balance_threshold_credits')
            .in('tenant_id', tenantIds)
        : Promise.resolve({ data: [] as WalletRow[], error: null as null }),
      tenantIds.length
        ? admin
            .from('ai_wallet_ledger')
            .select('tenant_id, kind, amount_credits, created_at')
            .gte('created_at', new Date(new Date().setUTCDate(1)).toISOString())
            .in('tenant_id', tenantIds)
        : Promise.resolve({ data: [] as LedgerRow[], error: null as null }),
    ]);

    const walletByTenant = new Map<string, WalletRow>();
    for (const row of walletsRes.data || [] as WalletRow[]) {
      walletByTenant.set(row.tenant_id, row);
    }

    const ledgerByTenant = new Map<string, { topups: number; spent: number }>();
    for (const row of ledgerRes.data || [] as LedgerRow[]) {
      const tenantId = row.tenant_id;
      const current = ledgerByTenant.get(tenantId) || { topups: 0, spent: 0 };
      if (row.kind === 'topup') current.topups += toNumber(row.amount_credits);
      else if (row.kind === 'reservation' || row.kind === 'usage' || row.kind === 'adjustment') current.spent += Math.abs(toNumber(row.amount_credits));
      else if (row.kind === 'refund') current.spent = Math.max(0, current.spent - Math.abs(toNumber(row.amount_credits)));
      ledgerByTenant.set(tenantId, current);
    }

    const payload = (tenants || []).map((tenant: { id: string; name?: string | null; created_at?: string }) => {
      const wallet = walletByTenant.get(tenant.id);
      const ledger = ledgerByTenant.get(tenant.id) || { topups: 0, spent: 0 };
      const monthProfitCredits = ledger.topups - ledger.spent;
      const balanceCredits = toNumber(wallet?.balance_credits);
      const lowBalanceThresholdCredits = toNumber(wallet?.low_balance_threshold_credits);
      const derivedStatus = deriveTenantStatus({
        balanceCredits,
        lowBalanceThresholdCredits,
        hasRecentLedgerActivity: ledger.topups > 0 || ledger.spent > 0,
      });

      return {
        id: tenant.id,
        name: tenant.name || tenant.id,
        status: derivedStatus,
        plan: 'free',
        createdAt: tenant.created_at,
        updatedAt: tenant.created_at,
        walletBalanceCredits: balanceCredits,
        lowBalanceThresholdCredits,
        monthTopupsCredits: ledger.topups,
        monthSpentCredits: ledger.spent,
        monthProfitCredits,
        riskStatus:
          derivedStatus === 'low_balance'
            ? 'low_balance'
            : derivedStatus === 'inactive'
              ? 'inactive'
              : monthProfitCredits < 0
                ? 'unprofitable'
                : 'healthy',
      };
    });

    const filteredPayload = status
      ? payload.filter((tenant: { status: string }) => tenant.status === status)
      : payload;

    return {
      tenants: filteredPayload,
      total: filteredPayload.length,
    };
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
