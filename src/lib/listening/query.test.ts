import { describe, expect, it } from '@jest/globals';
import { buildListeningQuery } from '@/lib/listening/query';

const config = {
  tenantId: 't1',
  businessName: 'Glow Salon',
  handles: ['@glow'],
  keywords: ['lagos'],
  platforms: ['instagram', 'twitter'],
  enabled: true,
  lastPolledAt: '2026-06-29T00:00:00.000Z',
};

describe('buildListeningQuery', () => {
  it('maps config to a provider query and carries since from lastPolledAt', () => {
    const query = buildListeningQuery(config);
    expect(query.businessName).toBe('Glow Salon');
    expect(query.handles).toEqual(['@glow']);
    expect(query.keywords).toEqual(['lagos']);
    expect(query.platforms).toEqual(['instagram', 'twitter']);
    expect(query.since).toBe('2026-06-29T00:00:00.000Z');
  });

  it('omits since when no lastPolledAt', () => {
    expect(buildListeningQuery({ ...config, lastPolledAt: null }).since).toBeUndefined();
  });
});
