import { createServerSupabaseClient } from '@/lib/supabase/server';
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
type QuotaBlockedError = Error & { code?: string };

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
    // propagate guard errors to caller; premium fallback can be handled upstream
    throw guardErr;
  }

  // Build prompt using promptEngine contract: tenantContext + messages array
   // Explicitly cast ctx.recentMessages to LlmContextMessage[]
  const recentStrings = (ctx.recentMessages as LlmContextMessage[]).map((m) => ((m as any).content ?? '').toString());
  const tenantContext: Record<string, unknown> = {
    tenant_id: ctx.tenant?.id ?? tenantId,
    name: ctx.tenant?.name,
    industry: ctx.tenant?.industry,
    tone_config: (ctx.tenant as TenantLlmSettings | null)?.tone_config,
    faqs: ctx.faqs,
  };
  const promptObj = buildPrompt(tenantContext as TenantContext, recentStrings, intent);

  // Redact again at adapter boundary to be safe
  try {
    const safePrompt = JSON.parse(JSON.stringify(promptObj));
    if (Array.isArray(safePrompt.messages)) safePrompt.messages = safePrompt.messages.map((m: string) => redactAndTruncate(m));
  const model = (ctx.tenant && (ctx.tenant as TenantLlmSettings).preferred_llm_model) || undefined;
    const reply = await OpenRouter.generateReplyFromPrompt(safePrompt, model as string | undefined);

  // metrics hook
  try { await metrics.incr('llm_call'); } catch { /* non-fatal */ }

    // Log llm_calls best-effort
    try {
      await supabase.from('llm_calls').insert([{ tenant_id: tenantId, action: reply.action || null, model: model || null, usage: reply._llm_usage || null, raw: reply || null }]);
    } catch (e) {
      console.warn('Failed to log llm call from adapter', e);
    }

    // Token usage accounting (best-effort)
    try {
      const tokens = typeof reply._llm_usage?.total_tokens === 'number' ? (reply._llm_usage.total_tokens as number) : null;
      if (tokens && tokens > 0) await addLlmTokens(supabase, tenantId, tokens);
    } catch (e) {
      console.warn('llmAdapter: addLlmTokens failed', e);
    }

    return reply;
  } catch (e) {
    console.warn('llmAdapter: failed to generate reply', e);
    throw e;
  }
}

export default generateReplyForTenant;
