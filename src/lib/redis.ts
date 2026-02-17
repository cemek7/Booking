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
let isInitializing = false;

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function createRedisError(message: string, redisErrorKind: RedisErrorKind, cause?: unknown): RedisError {
  const error = new Error(message) as RedisError;
  error.redisErrorKind = redisErrorKind;
  if (cause) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require('ioredis');
    try {
      connectPromise = null;
      connectError = null;
      client = new IORedis(url);
      return client;
    } catch (instantiationError) {
      throw createRedisError(
        `ioredis instantiation failed: ${instantiationError instanceof Error ? instantiationError.message : 'Unknown error'}`,
        'instantiation',
        instantiationError
      );
    }
  } catch (requireError) {
    if ((requireError as RedisError).redisErrorKind === 'instantiation') {
      throw requireError;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const redis = require('redis');
      try {
        connectPromise = null;
        connectError = null;
        client = redis.createClient({ url });

        if (typeof client.connect === 'function') {
          connectPromise = Promise.resolve(client.connect())
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
    } catch (nodeRedisError) {
      if ((nodeRedisError as RedisError).redisErrorKind === 'instantiation') {
        throw nodeRedisError;
      }

      throw new Error('Neither ioredis nor redis client library is installed');
    }
  }
}

async function ensureReadyClient() {
  // Guard against concurrent initialization
  if (isInitializing) {
    // Wait for the current initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  if (client && !connectError) {
    // Client already initialized successfully
    if (connectPromise) {
      await connectPromise;
    }
    return client;
  }

  try {
    isInitializing = true;
    const currentClient = ensureClient();

    if (connectPromise) {
      await connectPromise;
    }

    if (connectError) {
      throw connectError;
    }

    return currentClient;
  } finally {
    isInitializing = false;
  }
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
