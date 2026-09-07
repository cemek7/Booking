import { describe, expect, it, jest } from '@jest/globals';

const mockRunGenerators = jest.fn();
const mockListRecommendations = jest.fn();
const mockObserveOutcomes = jest.fn();
const mockSendHighValueRecommendationNudge = jest.fn();

jest.mock('./registry', () => ({
  runGenerators: (...args: unknown[]) => mockRunGenerators(...args),
}));

jest.mock('./outcomes', () => ({
  listRecommendations: (...args: unknown[]) => mockListRecommendations(...args),
  observeOutcomes: (...args: unknown[]) => mockObserveOutcomes(...args),
  sendHighValueRecommendationNudge: (...args: unknown[]) => mockSendHighValueRecommendationNudge(...args),
}));

import { runRecommendationCycle } from './job';

function makeAdmin() {
  return {
    from(table: string) {
      if (table !== 'tenants') {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: jest.fn().mockResolvedValue({
          data: [{ id: 'tenant-1' }, { id: 'tenant-2' }],
          error: null,
        }),
      };
    },
  } as never;
}

describe('runRecommendationCycle', () => {
  it('runs generators, outcomes, and nudges per tenant', async () => {
    mockRunGenerators.mockResolvedValue([{ id: 'draft-1' }]);
    mockListRecommendations.mockResolvedValue([{ id: 'rec-1', status: 'pending' }]);
    mockObserveOutcomes.mockResolvedValue({ acted: 1, expired: 0, ignored: 0 });
    mockSendHighValueRecommendationNudge.mockResolvedValue({ sent: true, count: 1 });

    const summary = await runRecommendationCycle(makeAdmin(), new Date('2026-07-21T00:00:00.000Z'));

    expect(mockRunGenerators).toHaveBeenCalledTimes(2);
    expect(mockObserveOutcomes).toHaveBeenCalledTimes(2);
    expect(mockSendHighValueRecommendationNudge).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      tenants: [
        {
          tenant_id: 'tenant-1',
          generated: 1,
          outcomes: { acted: 1, expired: 0, ignored: 0 },
          nudges: { sent: true, count: 1 },
        },
        {
          tenant_id: 'tenant-2',
          generated: 1,
          outcomes: { acted: 1, expired: 0, ignored: 0 },
          nudges: { sent: true, count: 1 },
        },
      ],
    });
  });
});
