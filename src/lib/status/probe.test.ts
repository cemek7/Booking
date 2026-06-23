import { describe, it, expect } from '@jest/globals';
import { classifyHealth, overallStatus } from '@/lib/status/probe';

describe('classifyHealth', () => {
  it('returns down when the probe is not ok', () => {
    expect(classifyHealth(false)).toBe('down');
    expect(classifyHealth(false, { status: 'ok' })).toBe('down');
  });

  it('returns degraded for degraded/warn/unhealthy bodies', () => {
    expect(classifyHealth(true, { status: 'degraded' })).toBe('degraded');
    expect(classifyHealth(true, { status: 'WARN' })).toBe('degraded');
    expect(classifyHealth(true, { status: 'unhealthy' })).toBe('degraded');
  });

  it('returns operational for ok bodies or missing status', () => {
    expect(classifyHealth(true, { status: 'ok' })).toBe('operational');
    expect(classifyHealth(true, null)).toBe('operational');
    expect(classifyHealth(true)).toBe('operational');
  });
});

describe('overallStatus', () => {
  it('reports the worst status', () => {
    expect(overallStatus(['operational', 'operational'])).toBe('operational');
    expect(overallStatus(['operational', 'degraded'])).toBe('degraded');
    expect(overallStatus(['degraded', 'down'])).toBe('down');
  });
});
