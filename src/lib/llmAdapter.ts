import { defaultLogger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LlmContextMessage } from '@/types/llm';
import { getContextForTenant } from './llmContextManager';
import buildPrompt, { TenantContext } from './promptEngine';
import type { Intent } from './intentDetector';
import OpenRouter from './openrouter';
import { redactAndTruncate } from './pii';
import type { TenantLlmSettings } from '@/types/llm';
import metrics from './metrics';
import { addLlmTokens } from './usageMetrics';
import { ensureTenantHasQuota } from './llmQuota';
import {
  estimatePromptTokens,
  estimateWalletSpend,
  allowNonExactCostFallback,
  extractUsageCostCredits,
  estimateActualCost,
  getTenantTokenRate,
  recordTenantCost,
  recordTenantRevenue,
  reserveTenantWalletSpend,
  settleTenantWalletSpend,
} from './billing/ai-wallet';

type QuotaBlockedError = Error & { code?: string };

function getPromptRate(ctx: TenantLlmSettings | null | undefined): number {
  return getTenantTokenRate(typeof ctx?.llm_token_rate === 'number' ? ctx.llm_token_rate : null);
}

/**
 * High-level helper that wires tenant context -> prompt builder -> OpenRouter
 * call. Callers should pass a server-side Supabase client instance.
 */
export async function generateReplyForTenant(tenantId: string, supabase: SupabaseClient, intent?: Intent) {
  if (!tenantId) throw new Error('tenantId required');
  const ctx = await getContextForTenant(tenantId, { supabaseClient: supabase, limit: 5 });

  // Quota / feature flag guard (runtime, minimal). If blocked, surface specific error.
  try {
    const quota = await ensureTenantHasQuota(supabase, tenantId);
    if (!quota.allowed) {
      const err = new Error(`llm_quota_block: ${quota.reason}`) as QuotaBlockedError;
      err.code = 'llm_quota_block';
      throw err;
    }
  } catch (guardErr) {
    throw guardErr;
  }

  const recentStrings = (ctx.recentMessages as LlmContextMessage[]).map((m) => ((m.content ?? '').toString()));
  const tenantContext: Record<string, unknown> = {
    tenant_id: ctx.tenant?.id ?? tenantId,
    name: ctx.tenant?.name,
    industry: ctx.tenant?.industry,
    tone_config: (ctx.tenant as TenantLlmSettings | null)?.tone_config,
    faqs: ctx.faqs,
    llm_token_rate: (ctx.tenant as TenantLlmSettings | null)?.llm_token_rate ?? null,
    verticalPackage: (ctx.tenant as Record<string, unknown> | null)?.verticalPackage,
    managedPromise: (ctx.tenant as Record<string, unknown> | null)?.managedPromise,
    outcomeTargets: (ctx.tenant as Record<string, unknown> | null)?.outcomeTargets,
    escalationRules: (ctx.tenant as Record<string, unknown> | null)?.escalationRules,
    operational_memory: (ctx.tenant as Record<string, unknown> | null)?.operational_memory,
    campaignDefaults: (ctx.tenant as Record<string, unknown> | null)?.campaignDefaults,
    billingModel: (ctx.tenant as Record<string, unknown> | null)?.billingModel,
  };
  const promptObj = buildPrompt(tenantContext as TenantContext, recentStrings, intent);

  const model = (ctx.tenant && (ctx.tenant as TenantLlmSettings).preferred_llm_model) || undefined;
  const tokenRate = getPromptRate(ctx.tenant as TenantLlmSettings | null | undefined);
  const promptSizeTokens = estimatePromptTokens(JSON.stringify(promptObj).length);
  const estimatedCredits = Math.max(0.05, Number((estimateWalletSpend(promptSizeTokens, tokenRate) * 1.25).toFixed(6)));
  const requestId = `${tenantId}:${Date.now()}`;

  const walletReserve = await reserveTenantWalletSpend(supabase, tenantId, estimatedCredits, {
    request_id: requestId,
    provider: 'openrouter',
    model: model || null,
    description: 'LLM reply reservation',
  });
  if (!walletReserve.allowed || !walletReserve.reservationId) {
    const err = new Error(`llm_wallet_block: ${walletReserve.reason || 'insufficient_balance'}`) as QuotaBlockedError;
    err.code = 'llm_wallet_block';
    throw err;
  }

  // Redact again at adapter boundary to be safe
  try {
    const safePrompt: { messages?: string[]; [key: string]: unknown } = JSON.parse(JSON.stringify(promptObj));
    if (Array.isArray(safePrompt.messages)) safePrompt.messages = safePrompt.messages.map((m: string) => redactAndTruncate(m));

    const reply = await OpenRouter.generateReplyFromPrompt(safePrompt, model as string | undefined);

    try { await metrics.incr('llm_call'); } catch { /* non-fatal */ }

    try {
      await supabase.from('llm_calls').insert([{ tenant_id: tenantId, action: reply.action || null, model: model || null, usage: reply._llm_usage || null, raw: reply || null }]);
    } catch (e) {
      defaultLogger.warn('Failed to log llm call from adapter', e);
    }

    try {
      const tokens = typeof reply._llm_usage?.total_tokens === 'number' ? Number(reply._llm_usage.total_tokens) : promptSizeTokens;
      if (tokens && tokens > 0) await addLlmTokens(supabase, tenantId, tokens);
      const exactCredits = extractUsageCostCredits(reply._llm_usage);
      const settledChargeCredits = estimatedCredits;
      const providerCostCredits = typeof exactCredits === 'number'
        ? exactCredits
        : allowNonExactCostFallback()
          ? estimateActualCost(settledChargeCredits)
          : null;
      const normalizedProviderCostCredits = typeof providerCostCredits === 'number' ? providerCostCredits : 0;
      if (typeof exactCredits !== 'number' && !allowNonExactCostFallback()) {
        throw new Error('exact_ai_cost_unavailable');
      }
      const settleResult = await settleTenantWalletSpend(
        supabase,
        tenantId,
        walletReserve.reservationId,
        estimatedCredits,
        settledChargeCredits,
        {
          request_id: requestId,
          provider: 'openrouter',
          model: model || null,
          tokens,
          tenant_charge_credits: settledChargeCredits,
          provider_cost_credits: providerCostCredits,
          cost_source: typeof exactCredits === 'number' ? 'provider_response' : 'estimated_fallback',
        }
      );
      if (!settleResult.allowed) {
        throw new Error(`wallet_settlement_failed: ${settleResult.reason || 'unknown'}`);
      }
      try {
        await recordTenantRevenue({
          tenantId,
          amountCredits: settledChargeCredits,
          revenueType: 'usage_charge',
          source: 'openrouter',
          reference: requestId,
          description: 'LLM reply charge',
          metadata: {
            request_id: requestId,
            provider: 'openrouter',
            model: model || null,
            tokens,
            tenant_charge_credits: settledChargeCredits,
            provider_cost_credits: providerCostCredits,
            cost_source: typeof exactCredits === 'number' ? 'provider_response' : 'estimated_fallback',
          },
        });
      } catch (e) {
        defaultLogger.warn('llmAdapter: recordTenantRevenue failed', e);
      }
      try {
        await recordTenantCost({
          tenantId,
          amountCredits: normalizedProviderCostCredits,
          costType: 'llm',
          source: 'openrouter',
          reference: requestId,
          description: 'OpenRouter usage cost',
          metadata: {
            request_id: requestId,
            provider: 'openrouter',
            model: model || null,
            tokens,
            tenant_charge_credits: settledChargeCredits,
            provider_cost_credits: normalizedProviderCostCredits,
            cost_source: typeof exactCredits === 'number' ? 'provider_response' : 'estimated_fallback',
          },
        });
      } catch (e) {
        defaultLogger.warn('llmAdapter: recordTenantCost failed', e);
      }
    } catch (e) {
      defaultLogger.warn('llmAdapter: addLlmTokens / wallet settlement failed', e);
    }

    return reply;
  } catch (e) {
    try {
      const rollbackSupabase = createServerSupabaseClient();
      await settleTenantWalletSpend(
        rollbackSupabase,
        tenantId,
        walletReserve.reservationId,
        estimatedCredits,
        0,
        {
          request_id: requestId,
          provider: 'openrouter',
          model: model || null,
          tokens: 0,
          error: String(e),
        }
      );
    } catch {
      // best-effort rollback only
    }
    defaultLogger.warn('llmAdapter: failed to generate reply', e);
    throw e;
  }
}

export default generateReplyForTenant;
