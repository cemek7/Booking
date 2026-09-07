import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCallOpenRouter = jest.fn();
const mockCallGoogleAI = jest.fn();
const mockIsGoogleConfigured = jest.fn();

jest.mock('@/lib/openrouter', () => ({
  callOpenRouter: (...args: unknown[]) => mockCallOpenRouter(...args),
}));

jest.mock('@/lib/google-ai', () => ({
  callGoogleAI: (...args: unknown[]) => mockCallGoogleAI(...args),
  isGoogleAIConfigured: () => mockIsGoogleConfigured(),
}));

import { nlToMetric } from './nlToMetric';

describe('nlToMetric', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T10:00:00.000Z'));
    mockCallOpenRouter.mockReset();
    mockCallGoogleAI.mockReset();
    mockIsGoogleConfigured.mockReset();
    mockIsGoogleConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('maps a revenue question to revenue_total for today via structured LLM output', async () => {
    mockCallOpenRouter.mockResolvedValue({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                metricKey: 'revenue_total',
                params: {
                  aggregation: 'sum',
                  filters: { period: 'today' },
                },
              }),
            },
          },
        ],
      },
    });

    const result = await nlToMetric('how much did we make today', { timezone: 'Africa/Lagos' });

    expect(result).toEqual({
      metricKey: 'revenue_total',
      params: {
        dimensions: [],
        aggregation: 'sum',
        filters: {
          period: 'today',
          period_start: '2026-07-21T00:00:00',
          period_end: '2026-07-22T00:00:00',
        },
      },
    });
  });

  it('returns a clarification when the model cannot map the question safely', async () => {
    mockCallOpenRouter.mockResolvedValue({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                clarification: 'Please ask about revenue, stock, customers, services, or staff performance.',
              }),
            },
          },
        ],
      },
    });

    const result = await nlToMetric('tell me something impossible');

    expect(result).toEqual({
      clarification: 'Please ask about revenue, stock, customers, services, or staff performance.',
    });
  });
});
