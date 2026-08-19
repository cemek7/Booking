import { defaultLogger } from '@/lib/logger';
/**
 * LLM Context Manager
 *
 * Provides a simple server-side helper to assemble a context object for LLM calls
 * which includes tenant LLM settings and recent conversation history.
 *
 * Usage (server-side):
 *  const ctx = await getContextForTenant(tenantId, { supabaseClient, limit: 20 });
 *  // ctx.tenant, ctx.recentMessages, ctx.recentLlMCalls
 *
 * Notes:
 * - This helper deliberately requires a server-side Supabase client instance
 *   to avoid doing DB access from the browser. Pass an existing server client
 *   (for example the one created in an API route or server component).
 * - Keep the returned payload small (truncate messages) to avoid sending large
 *   payloads to the LLM. The default limit is 20 messages.
 */

import type { LlmContext, LlmContextMessage, GetContextOpts } from '@/types/llm';
import { redactAndTruncate } from './pii';
import redisLib from './redis';
import summarizer from './summarizer';

export async function getContextForTenant(
  tenantId: string,
  opts: GetContextOpts = {}
): Promise<LlmContext> {
  const { supabaseClient, limit = 20, customerMessage } = opts;
  if (!supabaseClient) throw new Error('supabaseClient is required');

  // Fetch tenant record (include metadata for tone_config, preferred_language, business_hours)
  const { data: tenantData } = await supabaseClient
    .from('tenants')
    .select('id, name, settings, metadata, llm_token_rate, preferred_llm_model')
    .eq('id', tenantId)
    .maybeSingle();

  type RecentRaw = { id?: unknown; sender?: string | null; role?: string | null; content?: string | null; created_at?: string | null };
  let recentMessagesRaw: Array<RecentRaw> = [];
  try {
    // find latest chat id for tenant
    const { data: lastChat } = await supabaseClient.from('chats').select('id').eq('tenant_id', tenantId).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
    const chatId = lastChat && lastChat.id ? String(lastChat.id) : null;
    if (chatId) {
      let redisFailed = false;
      try {
        const recent = await redisLib.getRecent(chatId, limit);
        if (Array.isArray(recent) && recent.length) {
          recentMessagesRaw = recent.map((r: RecentRaw) => ({ id: r.id, role: (r.sender === 'customer') ? 'customer' : 'ai', content: r.content, created_at: r.created_at }));
        }
      } catch (err) {
        defaultLogger.warn('llmContextManager: redis.getRecent failed, falling back to DB', err);
        redisFailed = true;
      }

      // If Redis failed, force full DB fallback regardless of cache count
      if (redisFailed) {
        recentMessagesRaw = [];
      }
    }

    // If not enough from cache, fill from DB (messages table inbound)
    if (recentMessagesRaw.length < limit) {
      const remaining = limit - recentMessagesRaw.length;
      const { data: messages, error: messagesErr } = await supabaseClient
        .from('messages')
        .select('id, sender, content, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(remaining);
      if (messagesErr) defaultLogger.warn('llmContextManager: messages fetch error', messagesErr);
      if (Array.isArray(messages) && messages.length)
        recentMessagesRaw = recentMessagesRaw.concat(messages.map((m: RecentRaw) => ({
          id: m.id,
          role: m.sender === 'customer' ? 'customer' : 'ai',
          content: m.content,
          created_at: m.created_at
        })));
    }
  } catch (e) {
    defaultLogger.warn('llmContextManager: chat/messages lookup failed', e);
  }

  // Reverse so chronological (oldest first) and redact/truncate
  const recentMessages: LlmContextMessage[] = recentMessagesRaw
    .map((m) => ({ id: String(m.id), role: m.role ?? null, content: redactAndTruncate(m.content ?? null), created_at: m.created_at ?? null }))
    .reverse();

  // If history is large, produce a cheap summary to help LLM contexts
  const combined = recentMessages.map((m) => m.content ?? '').join(' | ');
  let recentSummary: string | null = combined.length > 2000 ? summarizer.summarizeMessages(recentMessages, 500) : null;

  // Recent chat summary (single)
  let recentChat: LlmContext['recentChat'] = null;
  try {
    // chats has no `message` column (message text lives in the messages table);
    // selecting it errored the whole query. Derive a preview from metadata.
    type ChatRow = { id?: unknown; customer_id?: string | null; created_at?: string | null; metadata?: Record<string, unknown> | null };
    const { data: chatRow } = await supabaseClient.from('chats').select('id, customer_id, created_at, metadata').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle() as { data?: ChatRow };
    if (chatRow) {
      const md = chatRow.metadata;
      const previewVal = md && typeof md === 'object'
        ? ((md as Record<string, unknown>)['last_message'] ?? (md as Record<string, unknown>)['subject'])
        : null;
      const preview = typeof previewVal === 'string' ? previewVal : null;
      recentChat = { id: String(chatRow.id), customer_id: chatRow.customer_id ?? null, message: redactAndTruncate(preview), created_at: chatRow.created_at ?? null, metadata: chatRow.metadata ?? null };
      // prefer an existing summarized version stored in metadata
      try {
        const md = chatRow.metadata ?? null;
        if (md && typeof md === 'object') {
          const summaryVal = (md as Record<string, unknown>)['summary'];
          if (typeof summaryVal === 'string' && summaryVal.length) {
            const s = redactAndTruncate(summaryVal);
            if (s) recentSummary = s;
          }
        }
      } catch {
        /* ignore metadata parse errors */
      }
    }
  } catch (e) {
    defaultLogger.warn('llmContextManager: recentChat lookup failed', e);
  }

  // LLM calls sample
  // llm_calls has no `tokens` column — token data lives in `usage` (jsonb).
  const { data: llmCalls, error: callsErr } = await supabaseClient.from('llm_calls').select('id, model, usage, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5);
  if (callsErr) defaultLogger.warn('llmContextManager: llm_calls fetch error', callsErr);

  // top faqs — keyword-based relevance if customerMessage provided, else recency
  let faqQuery = supabaseClient
    .from('faqs')
    .select('question, answer')
    .eq('tenant_id', tenantId);

  if (customerMessage) {
    const keywords = customerMessage
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);
    if (keywords.length) {
      faqQuery = faqQuery.or(keywords.map((k) => `question.ilike.%${k}%`).join(','));
    }
  } else {
    faqQuery = faqQuery.order('created_at', { ascending: false });
  }
  faqQuery = faqQuery.limit(5);

  const { data: faqsData, error: faqsErr } = await faqQuery;
  if (faqsErr) defaultLogger.warn('llmContextManager: faqs fetch error', faqsErr);
  const faqs = Array.isArray(faqsData) ? faqsData.map((f: { question?: string | null; answer?: string | null }) => ({ question: redactAndTruncate(f.question ?? ''), answer: redactAndTruncate(f.answer ?? '') })) : [];

  // services (top 10 active) for tenant-aware prompting
  const { data: servicesData } = await supabaseClient
    .from('services')
    .select('name, duration, price, category')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(10);

  // Extract agent-config fields from metadata
  const meta = (tenantData?.metadata ?? {}) as Record<string, unknown>;
  const toneConfig = (meta['tone_config'] ?? {}) as Record<string, unknown>;

  const tenantContext = {
    id: String(tenantData?.id ?? tenantId),
    ...(tenantData ?? {}),
    services: servicesData ?? [],
    preferred_language: (meta['preferred_language'] as string | undefined) ?? undefined,
    business_hours: (meta['business_hours'] as Record<string, { open: string | null; close: string | null; closed: boolean }> | undefined) ?? undefined,
    greeting: (toneConfig['greeting'] as string | undefined) ?? undefined,
    signature: (toneConfig['signature'] as string | undefined) ?? undefined,
    verticalPackage: (meta['verticalPackage'] as string | undefined) ?? undefined,
    managedPromise: (meta['managedPromise'] as string | undefined) ?? undefined,
    outcomeTargets: Array.isArray(meta['outcomeTargets']) ? (meta['outcomeTargets'] as string[]) : undefined,
    escalationRules: Array.isArray(meta['escalationRules']) ? (meta['escalationRules'] as string[]) : undefined,
    operational_memory: (meta['operationalMemory'] as Record<string, unknown> | undefined) ?? undefined,
    campaignDefaults: (meta['campaignDefaults'] as Record<string, unknown> | undefined) ?? undefined,
    billingModel: (meta['billingModel'] as string | undefined) ?? undefined,
    capture_leads: (meta['capture_leads'] as boolean | undefined) ?? false,
    follow_up_delay_hours: (meta['follow_up_delay_hours'] as number | undefined) ?? 24,
  };

  return {
    tenant: tenantContext ?? null,
    recentMessages,
    recentCalls: llmCalls ?? [],
    faqs,
    recentChat,
    recentSummary: recentSummary || '',
  };
}
