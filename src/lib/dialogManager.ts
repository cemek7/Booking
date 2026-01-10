import { v4 as uuidv4 } from 'uuid';
import { createServerSupabaseClient } from './supabaseClient';

// Lightweight dialog manager with Redis-first session store, Postgres fallback,
// and in-memory fallback for dev convenience. This provides a minimal slot-fill
// FSM API: startSession, getSession, updateSlot, nextStep, endSession.

type Session = {
  id: string;
  tenant_id?: string | null;
  user_id?: string | null;
  slots: Record<string, unknown>;
  state: string;
  created_at: string;
  updated_at: string;
};

let redisClient: any = null;
let usingRedis = false;
const inMemoryStore = new Map<string, Session>();

async function initRedisIfAvailable() {
  if (usingRedis || redisClient) return;
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    // dynamic import so repo doesn't require ioredis at install time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis');
    redisClient = new IORedis(url);
    usingRedis = true;
  } catch (e) {
    console.warn('ioredis not available or failed to connect — falling back to Postgres/in-memory session store', e);
    redisClient = null;
    usingRedis = false;
  }
}

async function writeSessionToStore(session: Session) {
  await initRedisIfAvailable();
  if (usingRedis && redisClient) {
    await redisClient.set(`dialog:session:${session.id}`, JSON.stringify(session));
    return true;
  }

  // Try Postgres via Supabase service client
  try {
    const supabase = createServerSupabaseClient();
    // Try upsert into dialog_sessions table — migration may be required
    await supabase.from('dialog_sessions').upsert([{ id: session.id, tenant_id: session.tenant_id, user_id: session.user_id, slots: session.slots, state: session.state, created_at: session.created_at, updated_at: session.updated_at }]);
    return true;
  } catch (e) {
    // Fallback to in-memory
    inMemoryStore.set(session.id, session);
    return false;
  }
}

async function readSessionFromStore(id: string): Promise<Session | null> {
  await initRedisIfAvailable();
  if (usingRedis && redisClient) {
    const raw = await redisClient.get(`dialog:session:${id}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as Session; } catch { return null; }
  }

  // Try Postgres
  try {
    const supabase = createServerSupabaseClient();
    const rq = await supabase.from('dialog_sessions').select('*').eq('id', id).maybeSingle();
    const data = (rq as any)?.data ?? null;
    if (data) {
      return {
        id: data.id,
        tenant_id: data.tenant_id,
        user_id: data.user_id,
        slots: data.slots || {},
        state: data.state || 'collecting',
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    }
  } catch (e) {
    // ignore and fallback
  }

  return inMemoryStore.get(id) ?? null;
}

export async function startSession(tenantId?: string | null, userId?: string | null) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const session: Session = { id, tenant_id: tenantId ?? null, user_id: userId ?? null, slots: {}, state: 'collecting', created_at: now, updated_at: now };
  await writeSessionToStore(session);
  return session;
}

export async function getSession(sessionId: string) {
  return await readSessionFromStore(sessionId);
}

export async function updateSlot(sessionId: string, key: string, value: unknown) {
  const s = await readSessionFromStore(sessionId);
  if (!s) throw new Error('session_not_found');
  s.slots = { ...(s.slots || {}), [key]: value };
  s.updated_at = new Date().toISOString();
  await writeSessionToStore(s);
  return s;
}

// Very small nextStep placeholder which checks required slots and returns next missing slot
export async function nextStep(sessionId: string, requiredSlots: string[] = []) {
  const s = await readSessionFromStore(sessionId);
  if (!s) throw new Error('session_not_found');
  for (const slot of requiredSlots) {
    if (typeof s.slots[slot] === 'undefined' || s.slots[slot] === null) return { next: slot, done: false };
  }
  // all required present
  s.state = 'complete';
  s.updated_at = new Date().toISOString();
  await writeSessionToStore(s);
  return { next: null, done: true };
}

export async function endSession(sessionId: string) {
  // Best-effort removal from stores
  await initRedisIfAvailable();
  if (usingRedis && redisClient) {
    try { await redisClient.del(`dialog:session:${sessionId}`); } catch {}
  }
  try {
    const supabase = createServerSupabaseClient();
    await supabase.from('dialog_sessions').delete().eq('id', sessionId);
  } catch {}
  inMemoryStore.delete(sessionId);
  return true;
}

// Booking-specific helper methods
export async function getBookingContext(sessionId: string): Promise<Record<string, unknown> | null> {
  const session = await readSessionFromStore(sessionId);
  if (!session) return null;
  
  const contextStr = session.slots.booking_context as string;
  if (!contextStr) return null;
  
  try {
    return JSON.parse(contextStr);
  } catch {
    return null;
  }
}

export async function updateBookingContext(sessionId: string, context: Record<string, unknown>) {
  return await updateSlot(sessionId, 'booking_context', JSON.stringify(context));
}

export async function getBookingState(sessionId: string): Promise<string | null> {
  const session = await readSessionFromStore(sessionId);
  return session?.slots.booking_state as string || null;
}

export async function setBookingState(sessionId: string, state: string) {
  return await updateSlot(sessionId, 'booking_state', state);
}

export async function attachBookingId(sessionId: string, bookingId: string) {
  return await updateSlot(sessionId, 'booking_id', bookingId);
}

export async function getBookingId(sessionId: string): Promise<string | null> {
  const session = await readSessionFromStore(sessionId);
  return session?.slots.booking_id as string || null;
}

const dialogManager = { 
  startSession, 
  getSession, 
  updateSlot, 
  nextStep, 
  endSession,
  getBookingContext,
  updateBookingContext,
  getBookingState,
  setBookingState,
  attachBookingId,
  getBookingId
};

export default dialogManager;
