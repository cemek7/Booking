import { describe, expect, it } from '@jest/globals';
import { resolveDayWindowUtc } from './reconciliationService';

describe('resolveDayWindowUtc', () => {
  it('maps a tenant-local date to a UTC [start,end) window', () => {
    const { startUtc, endUtc } = resolveDayWindowUtc('2026-07-15', 'Africa/Lagos');
    expect(startUtc).toBe('2026-07-14T23:00:00.000Z');
    expect(endUtc).toBe('2026-07-15T23:00:00.000Z');
  });
});
