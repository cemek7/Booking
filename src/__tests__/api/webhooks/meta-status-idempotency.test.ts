import { describe, it, expect } from '@jest/globals';
import { buildStatusIdempotencyKey } from '@/app/api/webhooks/whatsapp/meta/route';

describe('buildStatusIdempotencyKey', () => {
  it('distinguishes sent from delivered for the same wamid', () => {
    expect(buildStatusIdempotencyKey('wamid.ABC', 'sent'))
      .not.toBe(buildStatusIdempotencyKey('wamid.ABC', 'delivered'));
  });

  it('is stable for a replay of the same status', () => {
    expect(buildStatusIdempotencyKey('wamid.ABC', 'delivered'))
      .toBe(buildStatusIdempotencyKey('wamid.ABC', 'delivered'));
  });

  it('falls back to a literal when the status verb is missing', () => {
    expect(buildStatusIdempotencyKey('wamid.ABC', undefined))
      .toBe('wamid.ABC:unknown');
  });
});
