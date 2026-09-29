import { afterEach, describe, expect, it } from '@jest/globals';
import { getContinuityFlags } from '@/lib/whatsapp/v2/continuityFlags';

const KEYS = [
  'BOOKA_CONTINUITY_ROUTING_SESSIONS',
  'BOOKA_CONTINUITY_DURABLE_BATCHING',
  'BOOKA_CONTINUITY_THREAD_PROJECTION',
  'BOOKA_CONTINUITY_CONTEXT_MODE',
  'BOOKA_CONTINUITY_MEMORY_FACTS',
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('getContinuityFlags', () => {
  it('uses safe defaults when neither tenant nor environment opts in', () => {
    KEYS.forEach((key) => delete process.env[key]);
    expect(getContinuityFlags(null)).toEqual({
      routingSessions: false,
      durableBatching: false,
      threadProjection: false,
      contextMode: 'off',
      memoryFacts: false,
    });
  });

  it('reads valid environment defaults and rejects ambiguous truthy strings', () => {
    process.env.BOOKA_CONTINUITY_ROUTING_SESSIONS = 'true';
    process.env.BOOKA_CONTINUITY_DURABLE_BATCHING = '1';
    process.env.BOOKA_CONTINUITY_CONTEXT_MODE = 'shadow';
    expect(getContinuityFlags(null)).toMatchObject({
      routingSessions: true,
      durableBatching: false,
      contextMode: 'shadow',
    });
  });

  it('lets explicit tenant settings override environment defaults in both directions', () => {
    KEYS.forEach((key) => { process.env[key] = key === 'BOOKA_CONTINUITY_CONTEXT_MODE' ? 'live' : 'true'; });
    expect(getContinuityFlags({
      settings: {
        conversation_continuity: {
          routing_sessions: false,
          durable_batching: true,
          thread_projection: false,
          context_mode: 'shadow',
          memory_facts: false,
        },
      },
    })).toEqual({
      routingSessions: false,
      durableBatching: true,
      threadProjection: false,
      contextMode: 'shadow',
      memoryFacts: false,
    });
  });

  it('falls back safely for invalid tenant values', () => {
    expect(getContinuityFlags({ settings: { conversation_continuity: { context_mode: 'experimental' } } }))
      .toMatchObject({ contextMode: 'off' });
  });
});
