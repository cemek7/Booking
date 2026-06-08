// src/__tests__/lib/whatsapp/v2/brandIdentity.test.ts
import {
  resolveBrandContext,
  applyBrandIdentity,
  type TenantBrandFields,
  type ConversationBrandFields,
} from '@/lib/whatsapp/v2/brandIdentity';

const NOW = new Date('2026-06-08T12:00:00Z');

function tenant(overrides: Partial<TenantBrandFields> = {}): TenantBrandFields {
  return {
    name: 'Chris Barbershop',
    display_name: null,
    brand_emoji: '✂️',
    previous_names: null,
    renamed_at: null,
    ...overrides,
  };
}

describe('resolveBrandContext', () => {
  it('stamps header on session-open (last inbound > 30m ago)', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-06-08T11:00:00Z' };
    const ctx = resolveBrandContext(tenant(), conv, { initiated: false, now: NOW });
    expect(ctx.stampHeader).toBe(true);
  });

  it('suppresses header mid-conversation (last inbound 5m ago, not initiated)', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-06-08T11:55:00Z' };
    const ctx = resolveBrandContext(tenant(), conv, { initiated: false, now: NOW });
    expect(ctx.stampHeader).toBe(false);
  });

  it('always stamps header when initiated, even mid-conversation', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-06-08T11:55:00Z' };
    const ctx = resolveBrandContext(tenant(), conv, { initiated: true, now: NOW });
    expect(ctx.stampHeader).toBe(true);
  });

  it('treats null last_inbound_at as session-open', () => {
    const ctx = resolveBrandContext(tenant(), { last_inbound_at: null }, { initiated: false, now: NOW });
    expect(ctx.stampHeader).toBe(true);
  });

  it('falls back to name when display_name is null', () => {
    const ctx = resolveBrandContext(tenant(), { last_inbound_at: null }, { initiated: true, now: NOW });
    expect(ctx.displayName).toBe('Chris Barbershop');
  });

  it('uses display_name when set', () => {
    const ctx = resolveBrandContext(
      tenant({ display_name: 'Chris Cuts' }),
      { last_inbound_at: null },
      { initiated: true, now: NOW }
    );
    expect(ctx.displayName).toBe('Chris Cuts');
  });

  it('shows formerly when customer predates the rename', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-01-01T00:00:00Z' };
    const ctx = resolveBrandContext(
      tenant({
        display_name: 'Chris Grooming Lounge',
        renamed_at: '2026-03-01T00:00:00Z',
        previous_names: [{ name: 'Chris Barbershop', renamed_at: '2026-03-01T00:00:00Z' }],
      }),
      conv,
      { initiated: true, now: NOW }
    );
    expect(ctx.previousName).toBe('Chris Barbershop');
  });

  it('hides formerly when customer is newer than the rename', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-04-01T00:00:00Z' };
    const ctx = resolveBrandContext(
      tenant({
        renamed_at: '2026-03-01T00:00:00Z',
        previous_names: [{ name: 'Chris Barbershop', renamed_at: '2026-03-01T00:00:00Z' }],
      }),
      conv,
      { initiated: true, now: NOW }
    );
    expect(ctx.previousName).toBeNull();
  });

  it('uses the most recent previous name after multiple renames', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-01-01T00:00:00Z' };
    const ctx = resolveBrandContext(
      tenant({
        renamed_at: '2026-05-01T00:00:00Z',
        previous_names: [
          { name: 'Chris Barbershop', renamed_at: '2026-03-01T00:00:00Z' },
          { name: 'Chris Cuts', renamed_at: '2026-05-01T00:00:00Z' },
        ],
      }),
      conv,
      { initiated: true, now: NOW }
    );
    expect(ctx.previousName).toBe('Chris Cuts');
  });
});

describe('applyBrandIdentity', () => {
  const baseCtx = { displayName: 'Chris Barbershop', emoji: '✂️', previousName: null, stampHeader: true };

  it('returns reply unchanged when stampHeader is false', () => {
    expect(applyBrandIdentity('Sure, 2pm works', { ...baseCtx, stampHeader: false })).toBe('Sure, 2pm works');
  });

  it('prepends header with emoji and appends footer', () => {
    const out = applyBrandIdentity('Booked for 2pm.', baseCtx);
    expect(out).toContain('*Chris Barbershop* ✂️');
    expect(out).toContain('Booked for 2pm.');
    expect(out).toContain('reply STOP to opt out');
  });

  it('omits emoji cleanly when null', () => {
    const out = applyBrandIdentity('Hi', { ...baseCtx, emoji: null });
    expect(out.split('\n')[0]).toBe('*Chris Barbershop*');
  });

  it('includes the formerly line when previousName is set', () => {
    const out = applyBrandIdentity('Time for a cut?', { ...baseCtx, previousName: 'Chris Cuts' });
    expect(out).toContain('_(formerly Chris Cuts)_');
  });

  it('is idempotent — does not double-stamp an already-branded reply', () => {
    const once = applyBrandIdentity('Booked.', baseCtx);
    const twice = applyBrandIdentity(once, baseCtx);
    expect(twice).toBe(once);
  });
});
