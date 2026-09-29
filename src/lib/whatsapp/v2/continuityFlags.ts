export interface ContinuityFlags {
  routingSessions: boolean;
  durableBatching: boolean;
  threadProjection: boolean;
  contextMode: 'off' | 'shadow' | 'live';
  memoryFacts: boolean;
}

export interface TenantLike {
  settings?: Record<string, unknown> | null;
}

type TenantContinuitySettings = {
  routing_sessions?: unknown;
  durable_batching?: unknown;
  thread_projection?: unknown;
  context_mode?: unknown;
  memory_facts?: unknown;
};

function envBoolean(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true';
}

function contextMode(value: unknown, fallback: ContinuityFlags['contextMode']): ContinuityFlags['contextMode'] {
  return value === 'off' || value === 'shadow' || value === 'live' ? value : fallback;
}

function tenantSettings(tenant: TenantLike | null | undefined): TenantContinuitySettings {
  const value = tenant?.settings?.conversation_continuity;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as TenantContinuitySettings
    : {};
}

function tenantBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function getContinuityFlags(tenant: TenantLike | null | undefined): ContinuityFlags {
  const defaults: ContinuityFlags = {
    routingSessions: envBoolean('BOOKA_CONTINUITY_ROUTING_SESSIONS'),
    durableBatching: envBoolean('BOOKA_CONTINUITY_DURABLE_BATCHING'),
    threadProjection: envBoolean('BOOKA_CONTINUITY_THREAD_PROJECTION'),
    contextMode: contextMode(process.env.BOOKA_CONTINUITY_CONTEXT_MODE, 'off'),
    memoryFacts: envBoolean('BOOKA_CONTINUITY_MEMORY_FACTS'),
  };
  const settings = tenantSettings(tenant);
  return {
    routingSessions: tenantBoolean(settings.routing_sessions, defaults.routingSessions),
    durableBatching: tenantBoolean(settings.durable_batching, defaults.durableBatching),
    threadProjection: tenantBoolean(settings.thread_projection, defaults.threadProjection),
    contextMode: contextMode(settings.context_mode, defaults.contextMode),
    memoryFacts: tenantBoolean(settings.memory_facts, defaults.memoryFacts),
  };
}

export function hasLiveContinuity(flags: ContinuityFlags): boolean {
  return flags.routingSessions
    || flags.durableBatching
    || flags.threadProjection
    || flags.contextMode === 'live'
    || flags.memoryFacts;
}
