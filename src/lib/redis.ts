/* Lightweight Redis helper for server-side code. Uses ioredis or node-redis if available.
   This module is defensive: if REDIS_URL is missing or dependency not installed it throws
   only when a function requiring redis is called. */

import { defaultLogger } from '@/lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisClient = any;
type RedisErrorKind = 'instantiation' | 'connection';
type RedisError = Error & { redisErrorKind?: RedisErrorKind };

/**
 * Module-level state for Redis client singleton.
 * 
 * State Invariant: If connectError is non-null, then client MUST be null.
 * This invariant is maintained by ensureClient() which sets client=null when
 * connection fails (line 101). This ensures we never have a client instance
 * in an error state.
 * 
 * Valid states:
 * 1. Uninitialized: client=null, connectError=null, connectPromise=null
 * 2. IORedis (sync): client!=null, connectError=null, connectPromise=null
 * 3. node-redis (connecting): client!=null, connectError=null, connectPromise!=null
 * 4. node-redis (connected): client!=null, connectError=null, connectPromise=null
 * 5. Failed: client=null, connectError!=null, connectPromise=null
 */
let client: RedisClient | null = null;
let connectPromise: Promise<void> | null = null;
let connectError: RedisError | null = null;
let initializationPromise: Promise<RedisClient> | null = null;

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function createRedisError(message: string, redisErrorKind: RedisErrorKind, cause?: unknown): RedisError {
  const error = new Error(message, cause != null ? { cause } : undefined) as RedisError;
  error.redisErrorKind = redisErrorKind;
  return error;
}

export function isRedisFeatureEnabled() {
  const flag = process.env.REDIS_ENABLED;
  const hasRedisUrl = Boolean(process.env.REDIS_URL);
  
  // If REDIS_ENABLED is explicitly set (non-empty string), it takes precedence
  if (typeof flag === 'string' && flag.trim() !== '') {
    const isExplicitlyEnabled = ENABLED_VALUES.has(flag.trim().toLowerCase());
    // If explicitly enabled, also require REDIS_URL to prevent runtime failures
    if (isExplicitlyEnabled) {
      return hasRedisUrl;
    }
    // If explicitly disabled (e.g., "false", "0"), respect that regardless of REDIS_URL
    return false;
  }

  // If REDIS_ENABLED is empty/unset, fall back to REDIS_URL presence
  return hasRedisUrl;
}

/**
 * Checks if a Redis client package (ioredis or redis) is installed.
 * 
 * NOTE: This function uses require.resolve, a Node.js CJS API.
 * It is intended for server-side use only (Node.js runtime, not edge runtime).
 * The try-catch blocks provide runtime safety, but this code may behave
 * unpredictably in certain bundler contexts or edge runtime environments.
 * 
 * @returns {boolean} true if either ioredis or redis package is available
 */
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
              connectPromise = null;
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
  // If we're already initializing, wait for that initialization to complete
  if (initializationPromise) {
    return initializationPromise;
  }

  // If we have a client, check if it's ready
  // Note: We don't check !connectError here because the state invariant
  // guarantees that if connectError is set, client will be null.
  // See module-level documentation for details on state management.
  if (client) {
    if (connectPromise) {
      await connectPromise;
    }
    if (connectError) {
      throw connectError;
    }
    return client;
  }

  // Start initialization and store the promise so concurrent callers can await it
  initializationPromise = (async () => {
    try {
      ensureClient();

      if (connectPromise) {
        await connectPromise;
      }

      if (connectError) {
        throw connectError;
      }

      if (!client) {
        throw new Error('Redis client unavailable after connection');
      }

      return client;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
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
