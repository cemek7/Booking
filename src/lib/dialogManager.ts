// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

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

interface RedisLike {
  quit(): Promise<unknown>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

let redisClient: RedisLike | null = null;
let usingRedis = false;
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24-hour session TTL
const inMemoryStore = new Map<string, Session & { _expiresAt: number }>();

// Evict expired in-memory sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of inMemoryStore.entries()) {
    if (s._expiresAt < now) inMemoryStore.delete(id);
  }
}, 5 * 60 * 1000); // every 5 minutes

// Clean up Redis connection on process shutdown to avoid pool leaks in serverless envs
process.on('SIGTERM', () => {
  if (redisClient && typeof redisClient.quit === 'function') {
    redisClient.quit().catch(() => {});
  }
});

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
    defaultLogger.warn('ioredis not available or failed to connect — falling back to Postgres/in-memory session store', e);
    redisClient = null;
    usingRedis = false;
  }
}

async function writeSessionToStore(session: Session) {
  await initRedisIfAvailable();
  if (usingRedis && redisClient) {
    // Fail hard if Redis is configured but write fails — prevents split-brain across instances
    await redisClient.set(`dialog:session:${session.id}`, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
    return true;
  }

  // Try Postgres via Supabase service client
  try {
    const supabase = createSupabaseAdminClient();
    // Try upsert into dialog_sessions table — migration may be required
    await supabase.from('dialog_sessions').upsert([{ id: session.id, tenant_id: session.tenant_id, user_id: session.user_id, slots: session.slots, state: session.state, created_at: session.created_at, updated_at: session.updated_at }]);
    return true;
  } catch (e) {
    // Fallback to in-memory (single-instance dev only)
    inMemoryStore.set(session.id, { ...session, _expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
    return false;
  }
}

async function readSessionFromStore(id: string): Promise<Session | null> {
  await initRedisIfAvailable();
  if (usingRedis && redisClient) {
    // Fail hard if Redis is configured but read fails — prevents split-brain
    const raw = await redisClient.get(`dialog:session:${id}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as Session; } catch { return null; }
  }

  // Try Postgres
  try {
    const supabase = createSupabaseAdminClient();
    const rq = await supabase.from('dialog_sessions').select('*').eq('id', id).maybeSingle();
    const data = (rq.data as Session | null) ?? null;
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

  const mem = inMemoryStore.get(id);
  if (mem && mem._expiresAt > Date.now()) return mem;
  if (mem) inMemoryStore.delete(id); // evict expired
  return null;
}

export async function startSession(tenantId?: string | null, userId?: string | null) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const session: Session = { id, tenant_id: tenantId ?? null, user_id: userId ?? null, slots: {}, state: 'collecting', created_at: now, updated_at: now };
  await writeSessionToStore(session);
  return session;
}

export async function getSession(sessionId: string) {
  return await readSessionFromStore(sessionId);
}

async function assertTenantOwns(s: Session, tenantId?: string): Promise<void> {
  if (tenantId && s.tenant_id && s.tenant_id !== tenantId) {
    defaultLogger.error('[dialogManager] Cross-tenant write attempt', { sessionId: s.id, tenantId });
    throw new Error('Session tenant mismatch');
  }
}

export async function updateSlot(sessionId: string, key: string, value: unknown, tenantId?: string) {
  const s = await readSessionFromStore(sessionId);
  if (!s) throw new Error('session_not_found');
  await assertTenantOwns(s, tenantId);
  s.slots = { ...(s.slots || {}), [key]: value };
  s.updated_at = new Date().toISOString();
  await writeSessionToStore(s);
  return s;
}

/** Atomically update multiple slots in a single store write to prevent partial-state races */
export async function updateSlots(sessionId: string, patches: Record<string, unknown>, tenantId?: string) {
  const s = await readSessionFromStore(sessionId);
  if (!s) throw new Error('session_not_found');
  await assertTenantOwns(s, tenantId);
  s.slots = { ...(s.slots || {}), ...patches };
  s.updated_at = new Date().toISOString();
  await writeSessionToStore(s);
  return s;
}

// Very small nextStep placeholder which checks required slots and returns next missing slot
export async function nextStep(sessionId: string, requiredSlots: string[] = [], tenantId?: string) {
  const s = await readSessionFromStore(sessionId);
  if (!s) throw new Error('session_not_found');
  await assertTenantOwns(s, tenantId);
  for (const slot of requiredSlots) {
    if (typeof s.slots[slot] === 'undefined' || s.slots[slot] === null) return { next: slot, done: false };
  }
  // all required present
  s.state = 'complete';
  s.updated_at = new Date().toISOString();
  await writeSessionToStore(s);
  return { next: null, done: true };
}

export async function endSession(sessionId: string, tenantId?: string) {
  // Guard against cross-tenant session deletion
  if (tenantId) {
    const s = await readSessionFromStore(sessionId);
    if (s) await assertTenantOwns(s, tenantId);
  }
  // Best-effort removal from stores
  await initRedisIfAvailable();
  if (usingRedis && redisClient) {
    try { await redisClient.del(`dialog:session:${sessionId}`); } catch {}
  }
  try {
    const supabase = createSupabaseAdminClient();
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
  updateSlots,
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
