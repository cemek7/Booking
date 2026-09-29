import { describe, expect, it } from '@jest/globals';
import {
  continuityReadinessPolicy,
  continuityReadinessPolicyForTenants,
  isClaimRpcAvailable,
} from '@/app/api/ready/route';

describe('continuity readiness gate', () => {
  it('requires schema and claim RPC when any continuity behavior is live', () => {
    expect(continuityReadinessPolicy({
      routingSessions: true,
      durableBatching: false,
      threadProjection: false,
      contextMode: 'off',
      memoryFacts: false,
    })).toEqual({ requireSchema: true, advisoryWarning: null });
  });

  it('reports off and shadow configurations as advisory instead of live-ready', () => {
    expect(continuityReadinessPolicy({
      routingSessions: false,
      durableBatching: false,
      threadProjection: false,
      contextMode: 'shadow',
      memoryFacts: false,
    })).toEqual({
      requireSchema: false,
      advisoryWarning: expect.stringContaining('shadow'),
    });
  });

  it('reports a tenant shadow rollout even when global defaults are off', () => {
    const off = {
      routingSessions: false,
      durableBatching: false,
      threadProjection: false,
      contextMode: 'off' as const,
      memoryFacts: false,
    };
    expect(continuityReadinessPolicyForTenants(off, [
      { ...off, contextMode: 'shadow' },
    ])).toEqual({
      requireSchema: false,
      advisoryWarning: expect.stringContaining('shadow'),
    });
  });

  it('recognizes the safe required-argument error as proof the claim RPC exists', () => {
    expect(isClaimRpcAvailable({ code: 'P0001', message: 'worker id and settle cutoff are required' })).toBe(true);
    expect(isClaimRpcAvailable({ code: 'PGRST202', message: 'function not found' })).toBe(false);
    expect(isClaimRpcAvailable(null)).toBe(true);
  });
});
