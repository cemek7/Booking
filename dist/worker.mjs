// Lightweight ESM worker runner. Delegates core logic to worker_helper.mjs
import { createClient } from '@supabase/supabase-js';
import * as helper from './worker_helper.mjs';

export async function handler(payload) {
  if (!payload) return null;
  // Support background job payloads (e.g., reminders processing)
  const jobType = payload.job_type || payload.type || null;
  if (jobType === 'process_reminders' || jobType === 'reminders:process') {
    try {
      const tenantId = payload.tenant_id || null;
      const limit = payload.limit || 50;
      const res = await helper.processDueReminders({ tenantId, limit, useApi: false });
      return { status: 'processed_reminders', result: res };
    } catch (e) {
      console.warn('process_reminders job failed', e);
      return { status: 'error', error: String(e) };
    }
  }
  if (!payload.message_id) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase envs missing');

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const { data: msgData, error: msgErr } = await supabase.from('messages').select('*').eq('id', payload.message_id).maybeSingle();
  if (msgErr || !msgData) { console.warn('Message not found', msgErr); return null; }
  const message = msgData;
  const tenantId = message.tenant_id || payload.tenant_id || null;

  const redisClient = await helper.maybeCreateRedis();

  try {
    let sessionId = message.session_id || null;
    if (!sessionId) {
      try {
        const { data: sessData } = await supabase.from('dialog_sessions').insert([
          { tenant_id: tenantId || null, user_id: null, slots: { last_message_id: message.id }, state: 'collecting' }
        ]).select().maybeSingle();
        sessionId = sessData && sessData.id ? sessData.id : null;
        if (sessionId) { try { await supabase.from('messages').update({ session_id: sessionId }).eq('id', message.id); } catch (e) {} }
      } catch (e) { console.warn('Failed to create dialog session', e); }
    } else {
      try { await supabase.from('dialog_sessions').update({ slots: { last_message_id: message.id }, state: 'collecting' }).eq('id', sessionId); } catch (e) { console.warn('Failed to update dialog session', e); }
    }
  } catch (e) { console.warn('Dialog session handling failed', e); }

  const chatId = message.chat_id || null;
  const recentMsgs = await helper.loadRecentMessages(supabase, redisClient, chatId, tenantId, 20).catch((e) => { console.warn('Failed to load recent messages', e); return []; });

  const systemPrompt = `You are Booka assistant. Use tenant context and recent messages to produce a short reply or structured action.`;
  const messagesForLLM = [{ role: 'system', content: systemPrompt }];
  for (const m of recentMsgs) {
    const role = (m.sender === 'customer' || m.sender === 'user') ? 'user' : 'assistant';
    messagesForLLM.push({ role, content: helper.redactPII(m.content || '') });
  }
  messagesForLLM.push({ role: 'user', content: helper.redactPII(message.content || '') });

  let llmReply;
  try {
    const model = (message.preferred_llm_model) || process.env.OPENROUTER_DEFAULT_MODEL;
    llmReply = await helper.callOpenRouterPrompt(messagesForLLM, model).catch((e) => { throw e; });
  } catch (e) {
    console.warn('OpenRouter call failed', e);
    llmReply = { reply_text: 'Sorry, I could not process that right now.', action: 'none', data: null, _llm_usage: null };
  }

  try { await supabase.from('llm_calls').insert([{ tenant_id: tenantId, action: llmReply.action || null, model: process.env.OPENROUTER_DEFAULT_MODEL || null, usage: llmReply._llm_usage || null, raw: llmReply || null }]); } catch (e) { console.warn('Failed to log llm call', e); }

  if (llmReply.action === 'create_reservation' && llmReply.data) {
    try {
      const startRaw = llmReply.data.start_at || llmReply.data.start || null;
      const startDate = startRaw ? new Date(startRaw) : null;
      if (!startDate || isNaN(startDate.getTime())) {
        await helper.sendWhatsApp(tenantId, message.from_number, 'I could not understand the requested date/time. Can you provide a valid date and time?');
      } else {
        const startIso = startDate.toISOString();
        // Build a normalized payload for the worker-friendly shim which delegates
        // to the canonical reservation creation logic (reservation_helper.mjs).
        const durationMin = (llmReply.data && (llmReply.data.duration_minutes || llmReply.data.duration)) ? Number(llmReply.data.duration_minutes || llmReply.data.duration) : 60;
        const endIso = new Date(Date.parse(startIso) + Math.max(1, durationMin) * 60000).toISOString();
        const payloadForShim = {
          tenant_id: tenantId,
          customer_name: llmReply.data.customer_name || message.from_number,
          phone: message.from_number,
          service: llmReply.data.service || 'default',
          start_at: startIso,
          end_at: endIso,
          metadata: llmReply.data || null
        };

        const shimRes = await helper.createReservationFromWorker(payloadForShim);
        if (!shimRes || !shimRes.ok) {
          if (shimRes && shimRes.error === 'conflict') {
            await helper.sendWhatsApp(tenantId, message.from_number, 'Sorry — that slot is already taken. Would you like another time?');
          } else {
            console.warn('Failed to create reservation via shim', shimRes && shimRes.detail ? shimRes.detail : shimRes);
            await helper.sendWhatsApp(tenantId, message.from_number, 'Sorry, we could not create your booking right now. Please try again later.');
          }
        } else {
          const newRes = shimRes.data && shimRes.data.data ? shimRes.data.data : shimRes.data;
          if (newRes && newRes.id) {
            try { await supabase.from('messages').update({ reservation_id: newRes.id }).eq('id', message.id); } catch {}
            try {
              await supabase.from('reminders').insert([
                { tenant_id: tenantId, reservation_id: newRes.id, remind_at: new Date(new Date(newRes.start_at).getTime() - 24*60*60*1000).toISOString(), method: 'whatsapp', status: 'pending', raw: { to: message.from_number, message: `Reminder: your booking is scheduled for ${newRes.start_at}` } },
                { tenant_id: tenantId, reservation_id: newRes.id, remind_at: new Date(new Date(newRes.start_at).getTime() - 2*60*60*1000).toISOString(), method: 'whatsapp', status: 'pending', raw: { to: message.from_number, message: `Reminder: your booking is coming up at ${newRes.start_at}` } }
              ]);
            } catch (remErr) { console.warn('Failed to create reminders', remErr); }
          }
        }
      }
    } catch (e) { console.warn('Failed to create reservation', e); }
  }

  try {
    const inserted = await helper.insertAssistantMessage(supabase, tenantId, chatId, llmReply.reply_text || '', llmReply.raw || llmReply);
    await helper.updateChatAndCache(supabase, redisClient, chatId, inserted);
  } catch (e) { console.warn('Failed to insert/update assistant message', e); }

  try { const sendRes = await helper.sendWhatsApp(tenantId, message.from_number, llmReply.reply_text || ''); if (!sendRes.ok) console.warn('Failed to send message via Evolution', sendRes.response); } catch (e) { console.warn('Failed to send reply', e); }

  return { status: 'done' };
}

export async function runRemindersSweep(options = {}) {
  try {
    const res = await helper.processDueReminders(options);
    return res;
  } catch (e) {
    console.warn('runRemindersSweep failed', e && e.message ? e.message : e);
    return { ok: false, error: e };
  }
}

export default { handler };
