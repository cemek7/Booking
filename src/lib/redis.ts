/* Lightweight Redis helper for server-side code. Uses ioredis or node-redis if available.
   This module is defensive: if REDIS_URL is missing or dependency not installed it throws
   only when a function requiring redis is called. */

import { defaultLogger } from '@/lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisClient = any;
type RedisErrorKind = 'instantiation' | 'connection';
type RedisError = Error & { redisErrorKind?: RedisErrorKind };

let client: RedisClient | null = null;
let connectPromise: Promise<void> | null = null;
let connectError: RedisError | null = null;

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function createRedisError(message: string, redisErrorKind: RedisErrorKind, cause?: unknown): RedisError {
  const error = (cause ? new Error(message, { cause }) : new Error(message)) as RedisError;
  error.redisErrorKind = redisErrorKind;
  return error;
}

export function isRedisFeatureEnabled() {
  const flag = process.env.REDIS_ENABLED;
  if (typeof flag === 'string') {
    return ENABLED_VALUES.has(flag.toLowerCase());
  }

  return Boolean(process.env.REDIS_URL);
}

export function hasInstalledRedisClient() {
  return isModuleAvailable('ioredis') || isModuleAvailable('redis');
}

export function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

function isModuleAvailable(moduleName: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

function resetConnectionState() {
  connectPromise = null;
  connectError = null;
}

function createIORedisClient(url: string): RedisClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis');
    resetConnectionState();
    client = new IORedis(url);
    return client;
  } catch (instantiationError) {
    throw createRedisError(
      `ioredis instantiation failed: ${instantiationError instanceof Error ? instantiationError.message : 'Unknown error'}`,
      'instantiation',
      instantiationError
    );
  }
}

function createNodeRedisClient(url: string): RedisClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const redis = require('redis');
    resetConnectionState();
    client = redis.createClient({ url });

    if (typeof client.connect === 'function') {
      connectPromise = client.connect()
        .then(() => {
          connectError = null;
        })
        .catch((error: unknown) => {
          const wrappedError = createRedisError(
            `node-redis connect failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'connection',
            error
          );
          connectError = wrappedError;
          client = null;
          connectPromise = null;
          defaultLogger.error('Redis connect failed', { error: wrappedError.message });
          throw wrappedError;
        });
    }

    return client;
  } catch (instantiationError) {
    throw createRedisError(
      `node-redis instantiation failed: ${instantiationError instanceof Error ? instantiationError.message : 'Unknown error'}`,
      'instantiation',
      instantiationError
    );
  }
}

function ensureClient() {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');

  // Attempt ioredis
  if (isModuleAvailable('ioredis')) {
    return createIORedisClient(url);
  }

  // Attempt node-redis
  if (isModuleAvailable('redis')) {
    return createNodeRedisClient(url);
  }

  throw new Error('Redis client not installed (ioredis or redis)');
}

async function ensureReadyClient() {
  ensureClient();

  if (connectPromise) {
    await connectPromise;
  }

  if (connectError) {
    throw connectError;
  }

  if (!client) {
    throw new Error('Redis client was reset during connection attempt');
  }
  return client;
}

export async function lpushRecent(chatId: string, messageObj: object, maxLen = 200) {
  const c = await ensureReadyClient();
  const payload = JSON.stringify(messageObj);
  if (c.lpush) await c.lpush(`chat:${chatId}:recent`, payload);
  else if (c.lPush) await c.lPush(`chat:${chatId}:recent`, payload);
  if (c.ltrim) await c.ltrim(`chat:${chatId}:recent`, 0, maxLen - 1);
  else if (c.lTrim) await c.lTrim(`chat:${chatId}:recent`, 0, maxLen - 1);
}

export async function getRecent(chatId: string, limit = 50) {
  const c = await ensureReadyClient();
  const raw = (c.lrange) ? await c.lrange(`chat:${chatId}:recent`, 0, limit - 1) : await c.lRange(`chat:${chatId}:recent`, 0, limit - 1);
  if (!Array.isArray(raw)) return [];
  return raw.map((r: string) => {
    try { return JSON.parse(r); } catch { return { content: String(r) }; }
  }).reverse();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cacheSet(key: string, value: any, ttlSec?: number) {
  const c = await ensureReadyClient();
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
  const c = await ensureReadyClient();
  const v = (c.get) ? await c.get(key) : await c.GET(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return v; }
}

export async function pingRedis() {
  const c = await ensureReadyClient();
  if (typeof c.ping === 'function') return c.ping();
  if (typeof c.PING === 'function') return c.PING();
  throw new Error('Redis client does not support ping');
}

const redisLib = {
  lpushRecent,
  getRecent,
  cacheSet,
  cacheGet,
  pingRedis,
  isRedisFeatureEnabled,
  hasInstalledRedisClient,
  isRedisConfigured,
};

export default redisLib;
