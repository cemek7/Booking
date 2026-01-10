/* eslint-disable */
// ESM runtime helper for reservation creation used by dist/worker.mjs
// Exports a single `createReservation(supabaseUrl, supabaseKey, payload, actor?)`
import { createClient } from '@supabase/supabase-js';

async function createReservationWithClient(supabase, payload, actor) {
  if (!supabase) throw new Error('supabase client required');
  const { tenant_id, start_at, end_at } = payload || {};
  if (!tenant_id) throw new Error('tenant_id required');
  if (!start_at) throw new Error('start_at required');
  if (!end_at) throw new Error('end_at required');

  const { data: conflicts, error: confErr } = await supabase
    .from('reservations')
    .select('id')
    .eq('tenant_id', tenant_id)
    .lt('start_at', end_at)
    .gt('end_at', start_at)
    .limit(1);
  if (confErr) throw confErr;
  if (conflicts && conflicts.length > 0) {
    const err = new Error('Time slot unavailable');
    err.code = 'conflict';
    throw err;
  }

  const record = {
    tenant_id,
    customer_name: payload.customer_name || null,
    phone: payload.phone || null,
    service: payload.service || null,
    start_at,
    end_at,
    status: payload.status || 'confirmed',
    metadata: payload.metadata || null,
    staff_id: payload.staff_id || null,
  };

  const { data: inserted, error: insertErr } = await supabase.from('reservations').insert(record).select('*').maybeSingle();
  if (insertErr) throw insertErr;

  try {
    const actorObj = actor ?? { id: null, role: null };
    const notes = JSON.stringify({ customer_name: payload.customer_name, phone: payload.phone, service: payload.service, start_at, end_at });
    await supabase.from('reservation_logs').insert({ reservation_id: (inserted && inserted.id) || null, tenant_id, action: 'create', actor: actorObj, notes });
  } catch (logErr) {
    console.warn('reservation_helper: failed to write reservation_logs', logErr && logErr.message ? logErr.message : logErr);
  }

  try {
    if (inserted && inserted.id) {
      const rid = inserted.id;
      const start = new Date(start_at).getTime();
      const remind24 = new Date(start - 24 * 60 * 60 * 1000).toISOString();
      const remind2 = new Date(start - 2 * 60 * 60 * 1000).toISOString();
      await supabase.from('reminders').insert([
        { tenant_id, reservation_id: rid, remind_at: remind24, method: 'whatsapp', status: 'pending', raw: { reason: '24h' } },
        { tenant_id, reservation_id: rid, remind_at: remind2, method: 'whatsapp', status: 'pending', raw: { reason: '2h' } },
      ]);
    }
  } catch (remErr) {
    console.warn('reservation_helper: failed to create reminders', remErr && remErr.message ? remErr.message : remErr);
  }

  // Attach service via reservation_services join table when a service_id is provided
  try {
    const insertedId = inserted && inserted.id ? inserted.id : null;
    const serviceId = (payload && (payload.service_id || (typeof payload.service === 'string' && /^[0-9a-fA-F-]{36}$/.test(payload.service) ? payload.service : null))) || null;
    if (insertedId && serviceId) {
      try {
        await supabase.from('reservation_services').insert([{ reservation_id: insertedId, service_id: serviceId, tenant_id, customer_id: null, quantity: 1 }]);
      } catch (e) {
        console.warn('reservation_helper: failed to attach reservation service', e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    console.warn('reservation_helper: attach service check failed', e && e.message ? e.message : e);
  }

  return inserted;
}

export async function createReservation(supabaseUrlOrClient, supabaseKeyOrPayload, maybePayload, maybeActor) {
  if (!supabaseUrlOrClient) throw new Error('Missing supabase args');
  if (typeof supabaseUrlOrClient === 'object' && supabaseUrlOrClient !== null && typeof supabaseUrlOrClient.from === 'function') {
    const supabase = supabaseUrlOrClient;
    const payload = supabaseKeyOrPayload;
    const actor = maybePayload;
    return createReservationWithClient(supabase, payload, actor);
  }
  const supabaseUrl = supabaseUrlOrClient;
  const supabaseKey = supabaseKeyOrPayload;
  const payload = maybePayload;
  const actor = maybeActor;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase envs');
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  return createReservationWithClient(supabase, payload, actor);
}
