// ESM helper used by dist/worker.mjs. Converted from CommonJS.
import { createClient } from '@supabase/supabase-js';

async function maybeCreateRedis() {
  try {
    const mod = await import('ioredis').catch(() => null);
    const IORedis = mod ? (mod.default ?? mod) : null;
    const url = process.env.REDIS_URL;
    if (IORedis && url) return new IORedis(url);
  } catch (e) {
    // fall through to try node-redis
  }

  try {
    const mod = await import('redis').catch(() => null);
    const redis = mod ? (mod.default ?? mod) : null;
    if (!redis) return null;
    const client = redis.createClient({ url: process.env.REDIS_URL });
    await client.connect();
    return client;
  } catch (err) {
    console.warn('No redis client available (ioredis/redis not installed) or REDIS_URL missing');
    return null;
  }
}

function redactPII(text) {
  if (!text) return '';
  let out = String(text);
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]');
  out = out.replace(/\s{2,}/g, ' ').trim();
  if (out.length > 1200) out = out.slice(0, 1200) + '...';
  return out;
}

async function loadRecentMessages(supabase, redisClient, chatId, tenantId, limit = 20) {
  let msgs = [];
  try {
    if (redisClient) {
      const raw = await (redisClient.lrange ? redisClient.lrange(`chat:${chatId}:recent`, 0, limit - 1) : redisClient.lRange(`chat:${chatId}:recent`, 0, limit - 1));
      if (Array.isArray(raw) && raw.length) {
        msgs = raw.map((r) => {
          try { return JSON.parse(r); } catch { return { content: String(r) }; }
        }).reverse();
        if (msgs.length >= limit) return msgs.slice(-limit);
      }
    }
  } catch (e) {
    console.warn('Redis recent read failed', e && e.message ? e.message : e);
  }

  try {
    const q = supabase.from('messages').select('id, content, sender, direction, created_at').eq('tenant_id', tenantId).eq('chat_id', chatId).order('created_at', { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) {
      console.warn('Supabase messages fetch failed', error);
      return msgs;
    }
    if (Array.isArray(data) && data.length) {
      const parsed = data.map((m) => ({ id: String(m.id), sender: m.sender || (m.direction === 'inbound' ? 'customer' : 'ai'), content: redactPII(m.content || ''), created_at: m.created_at })).reverse();
      return parsed.slice(-limit);
    }
  } catch (e) {
    console.warn('messages fallback failed', e);
  }
  return msgs;
}

async function callOpenRouterPrompt(promptObject, model) {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  const OPENROUTER_BASE = process.env.OPENROUTER_BASE || 'https://api.openrouter.ai';
  const DEFAULT_MODEL = model || process.env.OPENROUTER_DEFAULT_MODEL || 'gpt-4o-mini';
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY not set');

  const res = await fetch(`${OPENROUTER_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: promptObject, temperature: 0.0, max_tokens: 1024 })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const assistant = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || null;
  if (!assistant) return { reply_text: '', action: 'none', data: null, _llm_usage: json?.usage ?? null };
  const m = (typeof assistant === 'string') ? assistant.match(/\{[\s\S]*\}/) : null;
  let parsed = null;
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch (e) { parsed = null; }
  }
  if (!parsed) {
    return { reply_text: (typeof assistant === 'string') ? assistant : '', action: 'none', data: null, _llm_usage: json?.usage ?? null, raw: json };
  }
  return { reply_text: parsed.reply_text || parsed.text || parsed.message || '', action: parsed.action || 'none', data: parsed.data || parsed.payload || null, _llm_usage: json?.usage ?? null, raw: json };
}

async function insertAssistantMessage(supabase, tenantId, chatId, assistantText, raw) {
  try {
    const { data: inserted, error } = await supabase.from('messages').insert([{
      tenant_id: tenantId,
      chat_id: chatId,
      content: assistantText,
      direction: 'out',
      sender: 'ai',
      raw
    }]).select('id, created_at, content').maybeSingle();
    if (error) {
      console.warn('Failed to insert assistant message', error);
      return null;
    }
    return inserted;
  } catch (e) {
    console.warn('insertAssistantMessage error', e);
    return null;
  }
}

async function updateChatAndCache(supabase, redisClient, chatId, inserted) {
  try {
    if (!inserted || !inserted.id) return;
    try { await supabase.from('chats').update({ last_message_id: inserted.id, last_message_at: inserted.created_at }).eq('id', chatId); } catch (e) { /* ignore */ }
    try {
      const payload = JSON.stringify({ id: inserted.id, sender: 'ai', content: inserted.content || '', created_at: inserted.created_at });
      if (redisClient) {
        if (redisClient.lpush) await redisClient.lpush(`chat:${chatId}:recent`, payload);
        else if (redisClient.lPush) await redisClient.lPush(`chat:${chatId}:recent`, payload);
        if (redisClient.ltrim) await redisClient.ltrim(`chat:${chatId}:recent`, 0, 199);
        else if (redisClient.lTrim) await redisClient.lTrim(`chat:${chatId}:recent`, 0, 199);
      }
    } catch (e) { /* ignore cache errors */ }
  } catch (e) {
    console.warn('updateChatAndCache error', e);
  }
}

async function sendWhatsApp(tenantId, toNumber, text) {
  const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
  const EVOLUTION_BASE = process.env.EVOLUTION_API_BASE || 'https://api.evolution.example';
  if (!EVOLUTION_KEY) return { ok: false, response: 'no_api_key' };
  const url = `${EVOLUTION_BASE}/message/send`;
  const payload = { to: toNumber, type: 'text', text: { body: text } };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EVOLUTION_KEY}` }, body: JSON.stringify(payload) });
  const body = await res.text();
  return { ok: res.ok, response: body };
}

// Process due reminders: either query DB directly or call the reminders trigger API.
// For each reminder, attempt to send via sendWhatsApp and update the reminder row.
async function processDueReminders(opts = {}) {
  const { tenantId = null, limit = 50, useApi = false } = opts || {};
  const nowIso = new Date().toISOString();

  try {
    let reminders = [];
    if (useApi) {
      const url = (process.env.REMINDERS_TRIGGER_URL) || (`${process.env.WORKER_API_BASE || ''}/api/reminders/trigger`);
      const body = tenantId ? { tenant_id: tenantId, limit } : { limit };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        console.warn('processDueReminders: trigger API responded', res.status);
        return { ok: false, error: 'trigger_api_failed', status: res.status };
      }
      const json = await res.json().catch(() => null);
      reminders = (json && Array.isArray(json.data)) ? json.data : [];
    } else {
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
      if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('missing_supabase_envs');
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      let q = supabase.from('reminders').select('*').lte('remind_at', nowIso).eq('status', 'pending').order('remind_at', { ascending: true }).limit(limit);
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { data, error } = await q;
      if (error) {
        console.warn('processDueReminders: reminders query failed', error);
        return { ok: false, error: 'query_failed', detail: error };
      }
      reminders = Array.isArray(data) ? data : [];
    }

    const results = [];
    for (const r of reminders) {
      try {
        const to = (r.raw && (r.raw.to || r.raw.phone)) || r.phone || null;
        const msg = (r.raw && (r.raw.message || r.raw.text)) || r.message || '';
        if (!to || !msg) {
          results.push({ id: r.id, ok: false, error: 'missing_payload' });
          // mark as failed to avoid tight loops
          try {
            if (!useApi) {
              const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
              const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
              const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
              await supabase.from('reminders').update({ status: 'failed', attempts: (r.attempts || 0) + 1, last_error: 'missing_payload' }).eq('id', r.id);
            }
          } catch (e) { /* ignore */ }
          continue;
        }

        const sendRes = await sendWhatsApp(r.tenant_id, to, msg).catch((e) => ({ ok: false, response: String(e) }));
        if (sendRes && sendRes.ok) {
          // mark reminder sent
          if (!useApi) {
            const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
            const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
            await supabase.from('reminders').update({ status: 'sent', sent_at: new Date().toISOString(), sent_result: sendRes.response }).eq('id', r.id);
          } else {
            // If using API path, expect the caller to reconcile status or provide a separate endpoint for marking sent.
          }
          results.push({ id: r.id, ok: true });
        } else {
          // Failed send — increment attempts and maybe mark failed after threshold
          const attempts = (r.attempts || 0) + 1;
          const maxAttempts = 3;
          if (!useApi) {
            const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
            const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
            await supabase.from('reminders').update({ attempts, last_error: sendRes ? sendRes.response : 'send_failed', status: attempts >= maxAttempts ? 'failed' : 'pending' }).eq('id', r.id);
          }
          results.push({ id: r.id, ok: false, attempts });
        }
      } catch (e) {
        console.warn('processDueReminders: send loop error', e);
        results.push({ id: r.id, ok: false, error: String(e) });
      }
    }
    return { ok: true, processed: results.length, results };
  } catch (e) {
    console.error('processDueReminders error', e);
    return { ok: false, error: String(e) };
  }
}

// Worker-friendly reservation creation wrapper that delegates to the dist shim.
async function createReservationFromWorker(payload) {
  try {
    const shim = await import('./reservation_helper.mjs');
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('missing_supabase_envs');
    const inserted = await shim.createReservation(SUPABASE_URL, SUPABASE_KEY, payload);
    return { ok: true, data: inserted };
  } catch (e) {
    if (e && e.code === 'conflict') return { ok: false, error: 'conflict', detail: e.message };
    return { ok: false, error: 'error', detail: e && e.message ? e.message : String(e) };
  }
}

// Process due reminders: fetch pending reminders where remind_at <= now,
// send via sendWhatsApp and mark as 'sent' or 'failed'.
// Options: { limit, tenantId, supabaseClient }
async function processDueReminders(options = {}) {
  const { limit = 50, tenantId = null, supabaseClient = null } = options || {};
  let supabase = supabaseClient;
  try {
    if (!supabase) {
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
      if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('missing_supabase_envs');
      const mod = await import('@supabase/supabase-js');
      const createClient = mod.createClient || mod.default?.createClient;
      if (!createClient) throw new Error('supabase client not available');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    }

    const nowIso = new Date().toISOString();
    let q = supabase.from('reminders').select('*').lte('remind_at', nowIso).eq('status', 'pending').order('remind_at', { ascending: true }).limit(limit);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data: reminders, error } = await q;
    if (error) {
      console.warn('processDueReminders: query failed', error);
      return { ok: false, error };
    }
    const rows = Array.isArray(reminders) ? reminders : [];
    let processed = 0;
    for (const r of rows) {
      try {
        // Determine destination and message
        let to = r?.raw?.to || null;
        let message = r?.raw?.message || null;
        let reservation = null;
        if ((!to || !message) && r.reservation_id) {
          const { data: resRow } = await supabase.from('reservations').select('phone,start_at,customer_name').eq('id', r.reservation_id).maybeSingle();
          reservation = resRow || null;
          if (!to) to = reservation?.phone || null;
          if (!message) message = `Reminder: your booking is scheduled for ${reservation?.start_at || ''}`;
        }

        if (!to || !message) {
          // can't send without destination
          await supabase.from('reminders').update({ status: 'failed', raw_response: JSON.stringify({ reason: 'missing_destination_or_message' }), updated_at: new Date().toISOString() }).eq('id', r.id);
          continue;
        }

        // Attempt send
        const sendRes = await sendWhatsApp(r.tenant_id, to, message).catch((e) => ({ ok: false, response: String(e) }));
        if (sendRes && sendRes.ok) {
          await supabase.from('reminders').update({ status: 'sent', raw_response: sendRes.response, sent_at: new Date().toISOString() }).eq('id', r.id);
        } else {
          await supabase.from('reminders').update({ status: 'failed', raw_response: sendRes ? sendRes.response : 'send_failed', updated_at: new Date().toISOString() }).eq('id', r.id);
        }
        processed += 1;
        // small delay to avoid rate limits
        await new Promise((res) => setTimeout(res, 150));
      } catch (e) {
        console.warn('processDueReminders: failed for reminder', r && r.id, e && e.message ? e.message : e);
        try { await supabase.from('reminders').update({ status: 'failed', raw_response: String(e), updated_at: new Date().toISOString() }).eq('id', r.id); } catch (uer) { /* ignore */ }
      }
    }
    return { ok: true, processed, total: rows.length };
  } catch (e) {
    console.warn('processDueReminders failed', e && e.message ? e.message : e);
    return { ok: false, error: e };
  }
}

export { maybeCreateRedis, loadRecentMessages, callOpenRouterPrompt, insertAssistantMessage, updateChatAndCache, sendWhatsApp, redactPII, createReservationFromWorker, processDueReminders };
