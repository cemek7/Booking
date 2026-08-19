import { defaultLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { redactAndTruncate } from './pii';
import { callOpenRouter } from './openrouter';
import { estimatePromptTokens, withTenantWalletSpend } from './billing/ai-wallet';

export async function summarizeChat(supabase: SupabaseClient, chatId: string, tenantId?: string) {
  // fetch recent messages for chat (limit to 200)
  const { data: msgs, error: msgsErr } = await supabase.from('messages').select('id, content, direction, created_at').eq('chat_id', chatId).eq('tenant_id', tenantId ?? '').order('created_at', { ascending: true }).limit(200);
  if (msgsErr) defaultLogger.warn('summarizer: failed to fetch messages', msgsErr);

  type MessageRow = { id?: string; content?: string | null; direction?: string | null; created_at?: string | null };
  const safeMsgs = Array.isArray(msgs) ? (msgs as MessageRow[]).map((m) => ({ role: (m.direction === 'inbound') ? 'user' : 'assistant', content: redactAndTruncate(m.content || '') })) : [];

  // Build prompt: ask for a concise summary of the conversation suitable for context
  const system = 'You are a concise summarizer for Booka. Produce a short one-paragraph summary (2-4 sentences) capturing the customer\'s intent, any reservations requested, and relevant details. Keep it under 200 words.';
  const messagesForLLM = [{ role: 'system', content: system }].concat(safeMsgs.slice(-50));
  const serverSupabase = createSupabaseAdminClient();

  let assistantText = '';
  try {
    const { json: j } = await withTenantWalletSpend(
      serverSupabase,
      tenantId ?? null,
      {
        estimatedTokens: estimatePromptTokens(messagesForLLM.map((m) => m.content).join('\n').length),
        provider: 'openrouter',
        requestId: `summary:${tenantId ?? 'anonymous'}:${chatId}:${Date.now()}`,
        description: 'Chat summarization',
        metadata: {
          chat_id: chatId,
        },
      },
      () => callOpenRouter(messagesForLLM, undefined, 1)
    );
    assistantText = String(j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || '');
  } catch (e) {
    defaultLogger.warn('summarizer: OpenRouter failed', e);
    assistantText = safeMsgs.slice(-5).map((m) => m.content).join(' | ').slice(0, 500);
  }

  const summary = redactAndTruncate(assistantText || '', 1000);

  // write back to chats.metadata.summary (merge existing metadata)
  try {
    const { data: chatRow } = await supabase.from('chats').select('id, metadata').eq('id', chatId).maybeSingle();
    const existingMd = (chatRow && (chatRow as unknown as { metadata?: Record<string, unknown> }).metadata) || {};
    const newMd = { ...(existingMd || {}), summary, summarized_at: new Date().toISOString() };
    await supabase.from('chats').update({ metadata: newMd }).eq('id', chatId).eq('tenant_id', tenantId ?? '');
  } catch (e) {
    defaultLogger.warn('summarizer: failed to write summary to chat metadata', e);
  }

  return { chatId, summary };
}
const summarizer = { summarizeChat };
export default summarizer;
