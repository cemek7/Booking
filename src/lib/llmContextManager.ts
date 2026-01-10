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

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LlmContext, LlmContextMessage, GetContextOpts } from '@/types/llm';
import { redactAndTruncate } from './pii';
import redisLib from './redis';
import summarizer from './summarizer';
import { Role } from '@/types';

  type RecentRaw = { id?: unknown; sender?: string | null; role?: Role | null; content?: string | null; created_at?: string | null };
  let recentMessagesRaw: Array<RecentRaw> = [];
  try {
    // find latest chat id for tenant
    const { data: lastChat } = await supabase.from('chats').select('id').eq('tenant_id', tenantId).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
    const chatId = lastChat && lastChat.id ? String(lastChat.id) : null;
    if (chatId) {
      try {
        const recent = await redisLib.getRecent(chatId, limit);
        if (Array.isArray(recent) && recent.length) {
          recentMessagesRaw = recent.map((r: RecentRaw) => ({ id: r.id, role: (r.sender === 'customer') ? 'customer' : 'ai', content: r.content, created_at: r.created_at }));
        }
      } catch (err) {
        console.warn('llmContextManager: redis.getRecent failed', err);
      }
    }

    // If not enough from cache, fill from DB (messages table inbound)
    if (recentMessagesRaw.length < limit) {
      const remaining = limit - recentMessagesRaw.length;
      const { data: messages, error: messagesErr } = await supabase
        .from('messages')
        .select('id, sender as role, content, created_at')
        .eq('tenant_id', tenantId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(remaining);
      if (messagesErr) console.warn('llmContextManager: messages fetch error', messagesErr);
      if (Array.isArray(messages) && messages.length)
        recentMessagesRaw = recentMessagesRaw.concat(messages.map((m: RecentRaw) => ({ id: m.id, role: m.role ?? 'customer', content: m.content, created_at: m.created_at })));
    }
  } catch (e) {
    console.warn('llmContextManager: chat/messages lookup failed', e);
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
    type ChatRow = { id?: unknown; customer_id?: string | null; message?: string | null; created_at?: string | null; metadata?: Record<string, unknown> | null };
    const { data: chatRow } = await supabase.from('chats').select('id, customer_id, message, created_at, metadata').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle() as { data?: ChatRow };
    if (chatRow) {
      recentChat = { id: String(chatRow.id), customer_id: chatRow.customer_id ?? null, message: redactAndTruncate(chatRow.message ?? null), created_at: chatRow.created_at ?? null, metadata: chatRow.metadata ?? null };
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
    console.warn('llmContextManager: recentChat lookup failed', e);
  }

  // LLM calls sample
  const { data: llmCalls, error: callsErr } = await supabase.from('llm_calls').select('id, model, tokens, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5);
  if (callsErr) console.warn('llmContextManager: llm_calls fetch error', callsErr);

  // top faqs
  const { data: faqsData, error: faqsErr } = await supabase.from('faqs').select('question, answer').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5);
  if (faqsErr) console.warn('llmContextManager: faqs fetch error', faqsErr);
  const faqs = Array.isArray(faqsData) ? faqsData.map((f: { question?: string | null; answer?: string | null }) => ({ question: redactAndTruncate(f.question ?? ''), answer: redactAndTruncate(f.answer ?? '') })) : [];

  return {
    tenant: tenantData ?? null,
    recentMessages,
    recentCalls: llmCalls ?? [],
    faqs,
    recentChat,
    recentSummary: recentSummary || '',
  };
}
