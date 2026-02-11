/* Lightweight Redis helper for server-side code. Uses ioredis or node-redis if available.
   This module is defensive: if REDIS_URL is missing or dependency not installed it throws
   only when a function requiring redis is called. */

type RedisClient = any;
let client: RedisClient | null = null;

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isRedisFeatureEnabled() {
  const flag = process.env.REDIS_ENABLED;
  if (typeof flag === 'string' && flag.trim() !== '') {
    return ENABLED_VALUES.has(flag.toLowerCase());
  }

  return Boolean(process.env.REDIS_URL);
}

export function hasInstalledRedisClient() {
  try {
    require.resolve('ioredis');
    return true;
  } catch {
    try {
      require.resolve('redis');
      return true;
    } catch {
      return false;
    }
  }
}

export function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

function ensureClient() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  if (!hasInstalledRedisClient()) throw new Error('Redis client not installed (ioredis or redis)');
  try {
    const IORedis = require('ioredis');
    client = new IORedis(url);
    return client;
  } catch (e) {
    try {
      const redis = require('redis');
      client = redis.createClient({ url });
      // node-redis connect is async; we rely on caller to await connect if needed
      if (typeof client.connect === 'function') client.connect().catch(() => {});
      return client;
    } catch (err) {
      throw new Error('Redis client not installed (ioredis or redis)');
    }
  }
}

export async function lpushRecent(chatId: string, messageObj: object, maxLen = 200) {
  const c = ensureClient();
  const payload = JSON.stringify(messageObj);
  if (c.lpush) await c.lpush(`chat:${chatId}:recent`, payload);
  else if (c.lPush) await c.lPush(`chat:${chatId}:recent`, payload);
  if (c.ltrim) await c.ltrim(`chat:${chatId}:recent`, 0, maxLen - 1);
  else if (c.lTrim) await c.lTrim(`chat:${chatId}:recent`, 0, maxLen - 1);
}

export async function getRecent(chatId: string, limit = 50) {
  const c = ensureClient();
  const raw = (c.lrange) ? await c.lrange(`chat:${chatId}:recent`, 0, limit - 1) : await c.lRange(`chat:${chatId}:recent`, 0, limit - 1);
  if (!Array.isArray(raw)) return [];
  return raw.map((r: string) => {
    try { return JSON.parse(r); } catch { return { content: String(r) }; }
  }).reverse();
}

export async function cacheSet(key: string, value: any, ttlSec?: number) {
  const c = ensureClient();
  const v = JSON.stringify(value);
  if (typeof ttlSec === 'number') {
    if (c.set) await c.set(key, v, 'EX', ttlSec);
    else if (c.SET) await c.SET(key, v, 'EX', ttlSec);
  } else {
    if (c.set) await c.set(key, v);
    else if (c.SET) await c.SET(key, v);
  }
}

export async function cacheGet(key: string) {
  const c = ensureClient();
  const v = (c.get) ? await c.get(key) : await c.GET(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return v; }
}

export async function pingRedis() {
  const c = ensureClient();
  if (typeof c.ping === 'function') return c.ping();
  if (typeof c.PING === 'function') return c.PING();
  throw new Error('Redis client does not support ping');
}

export default {
  lpushRecent,
  getRecent,
  cacheSet,
  cacheGet,
  pingRedis,
  isRedisFeatureEnabled,
  hasInstalledRedisClient,
  isRedisConfigured,
};
