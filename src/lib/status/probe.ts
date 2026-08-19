/** Health-probe classification for the public status page. Pure, no I/O. */

export type ProbeStatus = 'operational' | 'degraded' | 'down';

/**
 * Map an endpoint probe to a status:
 * - non-2xx / fetch failure  → 'down'
 * - 2xx + body.status degraded/warn → 'degraded'
 * - 2xx otherwise → 'operational'
 */
export function classifyHealth(ok: boolean, body?: { status?: string } | null): ProbeStatus {
  if (!ok) return 'down';
  const s = (body?.status ?? '').toLowerCase();
  if (s === 'degraded' || s === 'warn' || s === 'warning' || s === 'unhealthy') return 'degraded';
  return 'operational';
}

/** Worst status across probes — used for the overall banner. */
export function overallStatus(statuses: ProbeStatus[]): ProbeStatus {
  if (statuses.includes('down')) return 'down';
  if (statuses.includes('degraded')) return 'degraded';
  return 'operational';
}
