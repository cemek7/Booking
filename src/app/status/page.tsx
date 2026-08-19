'use client';

import React, { useEffect, useState } from 'react';
import { classifyHealth, overallStatus, type ProbeStatus } from '@/lib/status/probe';

interface Probe {
  name: string;
  path: string;
  status: ProbeStatus | 'checking';
}

const ENDPOINTS = [
  { name: 'API health', path: '/api/health' },
  { name: 'Readiness', path: '/api/ready' },
];

const LABEL: Record<ProbeStatus | 'checking', string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  checking: 'Checking…',
};

const DOT: Record<ProbeStatus | 'checking', string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
  checking: 'bg-gray-300',
};

export default function StatusPage() {
  const [probes, setProbes] = useState<Probe[]>(
    ENDPOINTS.map((e) => ({ ...e, status: 'checking' })),
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ENDPOINTS.map(async (e) => {
        try {
          const res = await fetch(e.path, { cache: 'no-store' });
          const body = await res.json().catch(() => null);
          return { ...e, status: classifyHealth(res.ok, body) } as Probe;
        } catch {
          return { ...e, status: 'down' as ProbeStatus } as Probe;
        }
      }),
    ).then((results) => {
      if (!cancelled) setProbes(results);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved = probes
    .map((p) => p.status)
    .filter((s): s is ProbeStatus => s !== 'checking');
  const overall = resolved.length === ENDPOINTS.length ? overallStatus(resolved) : 'checking';

  return (
    <main className="min-h-screen bg-[#f6f5ef] text-[#10211a]">
      <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>

        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[overall]}`} />
          <span className="font-medium">{LABEL[overall]}</span>
        </div>

        <ul className="mt-8 divide-y divide-[#e7e3d7] rounded-lg border border-[#e7e3d7] bg-white">
          {probes.map((p) => (
            <li key={p.path} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{p.name}</span>
              <span className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[p.status]}`} />
                {LABEL[p.status]}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-[#3a4a43]">
          Live check from your browser. For incident history and alerting, see the internal
          monitoring dashboard.
        </p>
      </div>
    </main>
  );
}
