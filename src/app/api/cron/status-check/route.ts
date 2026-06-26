export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { classifyHealth, type ProbeStatus } from '@/lib/status/probe';
import { alertOnProbeFailures } from '@/lib/status/alerting';

const ENDPOINTS = [
  { name: 'API health', path: '/api/health' },
  { name: 'Readiness', path: '/api/ready' },
];

/**
 * GET /api/cron/status-check
 * Scheduled probe: pings health + readiness and alerts (via the AlertService)
 * when anything is degraded/down. Protected by the CRON_SECRET bearer token,
 * matching the other cron/worker routes.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
  const results = await Promise.all(
    ENDPOINTS.map(async (e) => {
      try {
        const res = await fetch(`${base}${e.path}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        return { name: e.name, status: classifyHealth(res.ok, body) as ProbeStatus };
      } catch {
        return { name: e.name, status: 'down' as ProbeStatus };
      }
    }),
  );

  await alertOnProbeFailures(results);
  return NextResponse.json({ ok: true, results });
}
