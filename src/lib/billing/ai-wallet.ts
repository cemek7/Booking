import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export interface AiWalletSummary {
  tenant_id: string;
  currency: string;
  balance_credits: number;
  lifetime_topups_credits: number;
  lifetime_spent_credits: number;
  low_balance_threshold_credits: number;
  month_topups_credits: number;
  month_spent_credits: number;
  month_profit_credits: number;
  month_usage_revenue_credits: number;
  month_actual_cost_credits: number;
  month_realized_profit_credits: number;
  month_withdrawable_profit_credits: number;
  cash_collected_credits: number;
  recognized_revenue_credits: number;
  actual_cost_credits: number;
  realized_profit_credits: number;
  withdrawable_profit_credits: number;
  profit_reserve_credits: number;
  unsettled_liabilities_credits: number;
  month_tokens: number;
  recent_ledger: AiWalletLedgerEntry[];
  token_rate: number;
}

export interface TenantFinanceLedgerEntry {
  id: string;
  tenant_id: string;
  kind: 'wallet_topup' | 'usage_charge' | 'subscription_charge' | 'overage_charge' | 'refund' | 'manual_adjustment' | 'bonus_credit';
  amount_credits: number;
  source?: string | null;
  reference?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

function getFinanceReserveRate(): number {
  const value = Number(process.env.BOOKA_PROFIT_RESERVE_RATE || '0.2');
  return Number.isFinite(value) && value >= 0 ? value : 0.2;
}

function getCostRatio(): number {
  const value = Number(process.env.BOOKA_AI_COST_RATIO || '0.45');
  return Number.isFinite(value) && value >= 0 ? value : 0.45;
}

export function allowNonExactCostFallback(): boolean {
  return process.env.BOOKA_ALLOW_NON_EXACT_AI_COSTS === 'true';
}

export function estimateActualCost(tenantChargeCredits: number): number {
  if (!Number.isFinite(tenantChargeCredits) || tenantChargeCredits <= 0) return 0;
  return Number((tenantChargeCredits * getCostRatio()).toFixed(6));
}

export async function recordTenantRevenue(params: {
  tenantId: string;
  amountCredits: number;
  revenueType: TenantFinanceLedgerEntry['kind'];
  source: string;
  reference?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!Number.isFinite(params.amountCredits) || params.amountCredits === 0) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('tenant_revenue_ledger').upsert({
    tenant_id: params.tenantId,
    revenue_type: params.revenueType,
    amount_credits: params.amountCredits,
    source: params.source,
    reference: params.reference ?? null,
    description: params.description ?? null,
    metadata: params.metadata ?? {},
  }, { onConflict: 'tenant_id,revenue_type,reference', ignoreDuplicates: true });
  if (error) {
    console.warn('recordTenantRevenue failed', error);
  }
}

export async function recordTenantCost(params: {
  tenantId: string;
  amountCredits: number;
  costType: string;
  source: string;
  reference?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!Number.isFinite(params.amountCredits) || params.amountCredits === 0) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('tenant_cost_ledger').upsert({
    tenant_id: params.tenantId,
    cost_type: params.costType,
    actual_cost_credits: params.amountCredits,
    source: params.source,
    reference: params.reference ?? null,
    description: params.description ?? null,
    metadata: params.metadata ?? {},
  }, { onConflict: 'tenant_id,cost_type,reference', ignoreDuplicates: true });
  if (error) {
    console.warn('recordTenantCost failed', error);
  }
}

export interface AiWalletLedgerEntry {
  id: string;
  tenant_id: string;
  kind: 'topup' | 'reservation' | 'usage' | 'refund' | 'adjustment';
  amount_credits: number;
  token_count?: number | null;
  provider?: string | null;
  model?: string | null;
  request_id?: string | null;
  reference?: string | null;
  description?: string | null;
  created_at?: string | null;
}

export function getTenantTokenRate(tenantRate?: number | null): number {
  const envRate = Number(process.env.BOOKA_DEFAULT_LLM_TOKEN_RATE || '0.000002');
  const rate = typeof tenantRate === 'number' && Number.isFinite(tenantRate) && tenantRate > 0 ? tenantRate : envRate;
  return rate > 0 ? rate : 0.000002;
}

export function estimateWalletSpend(tokens: number, tokenRate: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  if (!Number.isFinite(tokenRate) || tokenRate <= 0) return 0;
  return Number((tokens * tokenRate).toFixed(6));
}

export function estimatePromptTokens(promptSizeChars: number): number {
  const chars = Math.max(0, promptSizeChars);
  return Math.max(256, Math.ceil(chars / 4) + 128);
}

export function extractUsageTokenCount(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const totalTokens = typeof u.total_tokens === 'number'
    ? u.total_tokens
    : typeof u.total === 'number'
      ? u.total
      : typeof u.tokens === 'number'
        ? u.tokens
        : typeof u.token_count === 'number'
          ? u.token_count
          : null;
  const promptTokens = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null;
  const completionTokens = typeof u.completion_tokens === 'number' ? u.completion_tokens : null;
  const tokens = typeof totalTokens === 'number'
    ? totalTokens
    : (promptTokens ?? 0) + (completionTokens ?? 0);

  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

export function extractUsageCostCredits(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const direct = typeof u.cost === 'number' ? u.cost : null;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) {
    return Number(direct.toFixed(6));
  }

  const providerCost = typeof u.provider_cost_credits === 'number' ? u.provider_cost_credits : null;
  if (typeof providerCost === 'number' && Number.isFinite(providerCost) && providerCost >= 0) {
    return Number(providerCost.toFixed(6));
  }

  const estimated = typeof u.estimated_cost === 'number' ? u.estimated_cost : null;
  if (typeof estimated === 'number' && Number.isFinite(estimated) && estimated >= 0) {
    return Number(estimated.toFixed(6));
  }

  return null;
}

export async function resolveTenantTokenRate(
  supabase: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('tenants')
    .select('llm_token_rate')
    .eq('id', tenantId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return getTenantTokenRate(null);
  }

  return getTenantTokenRate(Number(data?.llm_token_rate ?? null));
}

export interface WalletProtectedCallOptions {
  estimatedTokens: number;
  provider?: string | null;
  model?: string | null;
  requestId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export async function withTenantWalletSpend<T>(
  supabase: SupabaseClient,
  tenantId: string | null | undefined,
  options: WalletProtectedCallOptions,
  execute: () => Promise<T>
): Promise<T> {
  if (!tenantId) return execute();

  const tokenRate = await resolveTenantTokenRate(supabase, tenantId);
  const estimatedCredits = estimateWalletSpend(options.estimatedTokens, tokenRate);

  if (estimatedCredits <= 0) {
    return execute();
  }

  const reservation = await reserveTenantWalletSpend(supabase, tenantId, estimatedCredits, {
    provider: options.provider ?? null,
    model: options.model ?? null,
    request_id: options.requestId ?? null,
    description: options.description ?? 'AI spend reservation',
    ...options.metadata,
  });

  if (!reservation.allowed || !reservation.reservationId) {
    const reason = reservation.reason ?? 'wallet_reservation_failed';
    throw new Error(`wallet_block: ${reason}`);
  }

  try {
    const result = await execute();
    const resultUsage = (result as { usage?: unknown } | { json?: { usage?: unknown } } | { _llm_usage?: unknown } | null) || null;
    const usage =
      (resultUsage as { usage?: unknown } | null)?.usage
      ?? (resultUsage as { json?: { usage?: unknown } } | null)?.json?.usage
      ?? (resultUsage as { _llm_usage?: unknown } | null)?._llm_usage
      ?? null;
    const usageTokens = extractUsageTokenCount(usage) ?? options.estimatedTokens;
    const exactCredits = extractUsageCostCredits(usage);
    const settledChargeCredits = estimatedCredits;
    const providerCostCredits = typeof exactCredits === 'number'
      ? exactCredits
      : allowNonExactCostFallback()
        ? estimateActualCost(settledChargeCredits)
        : null;
    if (typeof exactCredits !== 'number' && !allowNonExactCostFallback()) {
      throw new Error('exact_ai_cost_unavailable');
    }
    if (process.env.BOOKA_REQUIRE_EXACT_AI_COSTS === 'true' && typeof exactCredits !== 'number') {
      throw new Error('exact_ai_cost_unavailable');
    }
    const settlement = await settleTenantWalletSpend(
      supabase,
      tenantId,
      reservation.reservationId,
      estimatedCredits,
      settledChargeCredits,
      {
        provider: options.provider ?? null,
        model: options.model ?? null,
        request_id: options.requestId ?? null,
        tokens: usageTokens,
        tenant_charge_credits: settledChargeCredits,
        provider_cost_credits: providerCostCredits,
        cost_source: typeof exactCredits === 'number' ? 'provider_response' : 'estimated_fallback',
        ...options.metadata,
      }
    );

    if (!settlement.allowed) {
      throw new Error(`wallet_settlement_failed: ${settlement.reason ?? 'unknown'}`);
    }

    try {
      await recordTenantRevenue({
        tenantId,
        amountCredits: settledChargeCredits,
        revenueType: 'usage_charge',
        source: 'ai',
        reference: options.requestId ?? reservation.reservationId,
        description: 'AI usage charge',
        metadata: {
          provider: options.provider ?? null,
          model: options.model ?? null,
          request_id: options.requestId ?? null,
          tokens: usageTokens,
          tenant_charge_credits: settledChargeCredits,
          provider_cost_credits: providerCostCredits,
          cost_source: typeof exactCredits === 'number' ? 'provider_response' : 'estimated_fallback',
        },
      });
    } catch (e) {
      console.warn('AI revenue ledger write failed', e);
    }
    if (typeof providerCostCredits === 'number') {
      try {
        await recordTenantCost({
          tenantId,
          amountCredits: providerCostCredits,
          costType: 'llm',
          source: 'ai',
          reference: options.requestId ?? reservation.reservationId,
          description: 'AI provider cost',
          metadata: {
            provider: options.provider ?? null,
            model: options.model ?? null,
            request_id: options.requestId ?? null,
            tokens: usageTokens,
            tenant_charge_credits: settledChargeCredits,
            provider_cost_credits: providerCostCredits,
            cost_source: typeof exactCredits === 'number' ? 'provider_response' : 'estimated_fallback',
          },
        });
      } catch (e) {
        console.warn('AI cost ledger write failed', e);
      }
    }

    return result;
  } catch (error) {
    try {
      await settleTenantWalletSpend(
        supabase,
        tenantId,
        reservation.reservationId,
        estimatedCredits,
        0,
        {
          provider: options.provider ?? null,
          model: options.model ?? null,
          request_id: options.requestId ?? null,
          tokens: 0,
          ...options.metadata,
        }
      );
    } catch (settleError) {
      // Best-effort rollback; if this fails we keep the original error path.
      console.warn('wallet rollback after AI failure failed', settleError);
    }
    throw error;
  }
}

export async function topUpTenantWallet(
  supabase: SupabaseClient,
  tenantId: string,
  amountCredits: number,
  description?: string,
  reference?: string
): Promise<{ allowed: boolean; balance_credits?: number; reason?: string }> {
  const { data, error } = await supabase.rpc('topup_ai_wallet', {
    p_tenant_id: tenantId,
    p_amount_credits: amountCredits,
    p_description: description ?? 'Manual top-up',
    p_reference: reference ?? null,
    p_metadata: {},
  });

  if (error) {
    return { allowed: false, reason: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  try {
    await recordTenantRevenue({
      tenantId,
      amountCredits,
      revenueType: 'wallet_topup',
      source: 'wallet',
      reference: reference ?? null,
      description: description ?? 'Manual top-up',
      metadata: {
        origin: 'wallet_topup',
        reference: reference ?? null,
      },
    });
  } catch (e) {
    console.warn('topUpTenantWallet revenue ledger write failed', e);
  }
  return { allowed: true, balance_credits: Number(row?.balance_credits ?? 0) };
}

export async function reserveTenantWalletSpend(
  supabase: SupabaseClient,
  tenantId: string,
  estimatedCredits: number,
  metadata?: Record<string, unknown>
): Promise<{ allowed: boolean; balance_credits?: number; reservationId?: string; reason?: string }> {
  const { data, error } = await supabase.rpc('reserve_ai_wallet_spend', {
    p_tenant_id: tenantId,
    p_amount_credits: estimatedCredits,
    p_request_id: (metadata?.request_id as string | undefined) ?? null,
    p_provider: (metadata?.provider as string | undefined) ?? null,
    p_model: (metadata?.model as string | undefined) ?? null,
    p_description: (metadata?.description as string | undefined) ?? 'AI spend reservation',
    p_metadata: metadata ?? {},
  });

  if (error) {
    return { allowed: false, reason: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    balance_credits: Number(row?.balance_credits ?? 0),
    reservationId: row?.reservation_id ?? undefined,
    reason: row?.reason ?? undefined,
  };
}

export async function settleTenantWalletSpend(
  supabase: SupabaseClient,
  tenantId: string,
  reservationId: string,
  estimatedCredits: number,
  actualCredits: number,
  metadata?: Record<string, unknown>
): Promise<{ allowed: boolean; balance_credits?: number; reason?: string }> {
  const { data, error } = await supabase.rpc('settle_ai_wallet_spend', {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
    p_estimated_credits: estimatedCredits,
    p_actual_credits: actualCredits,
    p_tokens: typeof metadata?.tokens === 'number' ? metadata.tokens : null,
    p_provider: (metadata?.provider as string | undefined) ?? null,
    p_model: (metadata?.model as string | undefined) ?? null,
    p_request_id: (metadata?.request_id as string | undefined) ?? null,
    p_metadata: metadata ?? {},
  });

  if (error) {
    return { allowed: false, reason: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    balance_credits: Number(row?.balance_credits ?? 0),
    reason: row?.reason ?? undefined,
  };
}

export async function getTenantWalletSummary(
  supabase: SupabaseClient,
  tenantId: string
): Promise<AiWalletSummary | null> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const admin = createSupabaseAdminClient();

  const [walletRes, ledgerRes, callsRes, tenantRes] = await Promise.all([
    admin.from('ai_wallets').select('*').eq('tenant_id', tenantId).maybeSingle(),
    admin
      .from('ai_wallet_ledger')
      .select('id, tenant_id, kind, amount_credits, token_count, provider, model, request_id, reference, description, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('llm_calls')
      .select('id, usage, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStart.toISOString()),
    admin
      .from('tenants')
      .select('llm_token_rate')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  if (walletRes.error && walletRes.error.code !== 'PGRST116') return null;
  if (ledgerRes.error) return null;
  if (callsRes.error) return null;
  if (tenantRes.error && tenantRes.error.code !== 'PGRST116') return null;

  const wallet = walletRes.data || null;
  if (!wallet) return null;

  const [revenueRes, costRes] = await Promise.all([
    admin
      .from('tenant_revenue_ledger')
      .select('id, tenant_id, revenue_type, amount_credits, source, reference, description, metadata, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('tenant_cost_ledger')
      .select('id, tenant_id, cost_type, actual_cost_credits, source, reference, description, metadata, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  if (revenueRes.error) return null;
  if (costRes.error) return null;

  const ledgerRows = (ledgerRes.data ?? []) as Array<Record<string, unknown>>;
  const revenueRows = (revenueRes.data ?? []) as Array<Record<string, unknown>>;
  const costRows = (costRes.data ?? []) as Array<Record<string, unknown>>;
  const callRows = (callsRes.data ?? []) as Array<{ usage?: Record<string, unknown> | null }>;

  const recentLedger = ledgerRows.map((row: Record<string, unknown>) => ({
    id: String((row as { id: unknown }).id),
    tenant_id: String((row as { tenant_id: unknown }).tenant_id),
    kind: row.kind as AiWalletLedgerEntry['kind'],
    amount_credits: Number(row.amount_credits || 0),
    token_count: row.token_count != null ? Number(row.token_count) : null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    request_id: row.request_id ?? null,
    reference: row.reference ?? null,
    description: row.description ?? null,
    created_at: row.created_at ?? null,
  })) as AiWalletLedgerEntry[];

  const revenueEntries = revenueRows.map((row: Record<string, unknown>) => ({
    id: String((row as { id: unknown }).id),
    tenant_id: String((row as { tenant_id: unknown }).tenant_id),
    kind: row.revenue_type as TenantFinanceLedgerEntry['kind'],
    amount_credits: Number((row as { amount_credits: unknown }).amount_credits || 0),
    source: (row as { source?: string | null }).source ?? null,
    reference: (row as { reference?: string | null }).reference ?? null,
    description: (row as { description?: string | null }).description ?? null,
    metadata: (row as { metadata?: Record<string, unknown> | null }).metadata ?? null,
    created_at: (row as { created_at?: string | null }).created_at ?? null,
  })) as TenantFinanceLedgerEntry[];

  const costEntries = costRows.map((row: Record<string, unknown>) => ({
    id: String((row as { id: unknown }).id),
    tenant_id: String((row as { tenant_id: unknown }).tenant_id),
    kind: 'manual_adjustment' as const,
    amount_credits: Number((row as { actual_cost_credits: unknown }).actual_cost_credits || 0),
    source: (row as { source?: string | null }).source ?? null,
    reference: (row as { reference?: string | null }).reference ?? null,
    description: (row as { description?: string | null }).description ?? null,
    metadata: (row as { metadata?: Record<string, unknown> | null }).metadata ?? null,
    created_at: (row as { created_at?: string | null }).created_at ?? null,
  }));

  const monthTopups = recentLedger
    .filter((entry) => entry.kind === 'topup')
    .reduce((sum, entry) => sum + Number(entry.amount_credits || 0), 0);
  const monthSpent = recentLedger
    .filter((entry) => entry.kind === 'usage' || entry.kind === 'reservation')
    .reduce((sum, entry) => sum + Math.abs(Number(entry.amount_credits || 0)), 0);
  const cashCollected = revenueEntries
    .filter((entry) => entry.kind === 'wallet_topup')
    .reduce((sum, entry) => sum + Number(entry.amount_credits || 0), 0);
  const recognizedRevenue = revenueEntries
    .filter((entry) => entry.kind === 'usage_charge' || entry.kind === 'subscription_charge' || entry.kind === 'overage_charge')
    .reduce((sum, entry) => sum + Number(entry.amount_credits || 0), 0);
  const actualCost = costEntries.reduce((sum, entry) => sum + Number(entry.amount_credits || 0), 0);
  const realizedProfit = recognizedRevenue - actualCost;
  const reserveCredits = Math.max(0, Number((realizedProfit * getFinanceReserveRate()).toFixed(6)));
  const withdrawableProfit = Math.max(0, realizedProfit - reserveCredits);
  const monthTokens = callRows.reduce((sum: number, row) => {
    const usage = row.usage;
    const tokens = usage ? Number(usage.total_tokens ?? usage.total ?? usage.tokens ?? usage.token_count ?? 0) : 0;
    return sum + (Number.isFinite(tokens) ? tokens : 0);
  }, 0);

  return {
    tenant_id: tenantId,
    currency: wallet.currency ?? 'credits',
    balance_credits: Number(wallet.balance_credits ?? 0),
    lifetime_topups_credits: Number(wallet.lifetime_topups_credits ?? 0),
    lifetime_spent_credits: Number(wallet.lifetime_spent_credits ?? 0),
    low_balance_threshold_credits: Number(wallet.low_balance_threshold_credits ?? 0),
    month_topups_credits: monthTopups,
    month_spent_credits: monthSpent,
    month_profit_credits: realizedProfit,
    month_usage_revenue_credits: recognizedRevenue,
    month_actual_cost_credits: actualCost,
    month_realized_profit_credits: realizedProfit,
    month_withdrawable_profit_credits: withdrawableProfit,
    cash_collected_credits: cashCollected,
    recognized_revenue_credits: recognizedRevenue,
    actual_cost_credits: actualCost,
    realized_profit_credits: realizedProfit,
    withdrawable_profit_credits: withdrawableProfit,
    profit_reserve_credits: reserveCredits,
    unsettled_liabilities_credits: Number(wallet.balance_credits ?? 0),
    month_tokens: monthTokens,
    recent_ledger: recentLedger,
    token_rate: getTenantTokenRate(Number(tenantRes.data?.llm_token_rate ?? null)),
  };
}
