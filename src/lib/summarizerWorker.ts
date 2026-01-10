import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redactAndTruncate } from './pii';

async function callOpenRouterSimple(messages: Array<{ role: string; content: string }>, model?: string) {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  const OPENROUTER_BASE = process.env.OPENROUTER_BASE || 'https://api.openrouter.ai';
  const DEFAULT_MODEL = model || process.env.OPENROUTER_DEFAULT_MODEL || 'gpt-4o-mini';
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY not set');

  const res = await fetch(`${OPENROUTER_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages, temperature: 0.0, max_tokens: 512 })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const assistant = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
  return String(assistant || '');
}

export async function summarizeChat(supabase: SupabaseClient, chatId: string, tenantId?: string) {
  // fetch recent messages for chat (limit to 200)
  const { data: msgs, error: msgsErr } = await supabase.from('messages').select('id, content, sender, created_at').eq('chat_id', chatId).order('created_at', { ascending: true }).limit(200);
  if (msgsErr) console.warn('summarizer: failed to fetch messages', msgsErr);

  type MessageRow = { id?: string; content?: string | null; sender?: string | null; created_at?: string | null };
  const safeMsgs = Array.isArray(msgs) ? (msgs as MessageRow[]).map((m) => ({ role: (m.sender === 'customer' || m.sender === 'user') ? 'user' : 'assistant', content: redactAndTruncate(m.content || '') })) : [];

  // Build prompt: ask for a concise summary of the conversation suitable for context
  const system = 'You are a concise summarizer for Booka. Produce a short one-paragraph summary (2-4 sentences) capturing the customer\'s intent, any reservations requested, and relevant details. Keep it under 200 words.';
  const messagesForLLM = [{ role: 'system', content: system }].concat(safeMsgs.slice(-50));

  let assistantText = '';
  try {
    assistantText = await callOpenRouterSimple(messagesForLLM, undefined);
  } catch (e) {
    console.warn('summarizer: OpenRouter failed', e);
    assistantText = safeMsgs.slice(-5).map((m) => m.content).join(' | ').slice(0, 500);
  }

  const summary = redactAndTruncate(assistantText || '', 1000);

  // write back to chats.metadata.summary (merge existing metadata)
  try {
    const { data: chatRow } = await supabase.from('chats').select('id, metadata').eq('id', chatId).maybeSingle();
    const existingMd = (chatRow && (chatRow as unknown as { metadata?: Record<string, unknown> }).metadata) || {};
    const newMd = { ...(existingMd || {}), summary, summarized_at: new Date().toISOString() };
    await supabase.from('chats').update({ metadata: newMd }).eq('id', chatId);
  } catch (e) {
    console.warn('summarizer: failed to write summary to chat metadata', e);
  }

  return { chatId, summary };
}
const summarizer = { summarizeChat };
export default summarizer;
