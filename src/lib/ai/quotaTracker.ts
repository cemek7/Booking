/**
 * AI Quota Tracker
 *
 * Tracks per-tenant and global daily AI call counts from the messages table.
 * When a quota is exceeded the pipeline degrades gracefully to L1-only mode
 * (button menus instead of free-form AI responses).
 *
 * Budgets are read from env vars so they can be tuned without a deploy:
 *   AI_LITE_DAILY_BUDGET   — daily Flash-Lite call limit across all tenants (default 800)
 *   AI_FLASH_DAILY_BUDGET  — daily Flash call limit across all tenants (default 200)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LITE_BUDGET = parseInt(process.env.AI_LITE_DAILY_BUDGET ?? '800', 10);
const FLASH_BUDGET = parseInt(process.env.AI_FLASH_DAILY_BUDGET ?? '200', 10);

export type AILayer = 'lite' | 'flash';

// ─── Usage query ──────────────────────────────────────────────────────────────

/**
 * Returns today's AI call count for a specific layer.
 * Counts rows from the messages table where ai_layer matches and created_at is today.
 */
export async function getTenantAIUsageToday(
  tenantId: string,
  layer: AILayer
): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('ai_layer', layer)
    .gte('created_at', todayStart.toISOString());

  if (error) {
    console.error('[quotaTracker] getTenantAIUsageToday error', error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Returns today's global AI call count for a layer (across all tenants).
 * Used for the system-wide hard limit.
 */
async function getGlobalAIUsageToday(layer: AILayer): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('ai_layer', layer)
    .gte('created_at', todayStart.toISOString());

  if (error) {
    console.error('[quotaTracker] getGlobalAIUsageToday error', error);
    return 0;
  }

  return count ?? 0;
}

// ─── Quota check ──────────────────────────────────────────────────────────────

/**
 * Returns true if the AI layer's daily budget has been reached.
 * Checks the global counter (per-tenant limits can be added later via tenant config).
 */
export async function isQuotaExceeded(layer: AILayer): Promise<boolean> {
  const budget = layer === 'lite' ? LITE_BUDGET : FLASH_BUDGET;
  const used = await getGlobalAIUsageToday(layer);
  return used >= budget;
}

// ─── Usage recording ─────────────────────────────────────────────────────────

/**
 * Updates the messages row to record which AI layer handled it and token count.
 * Called after a successful L2/L3 response.
 */
export async function recordAIUsage(
  messageId: string,
  layer: AILayer,
  tokensUsed: number
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('messages')
    .update({ ai_layer: layer, tokens_used: tokensUsed })
    .eq('id', messageId);

  if (error) {
    console.error('[quotaTracker] recordAIUsage error', error);
  }
}
