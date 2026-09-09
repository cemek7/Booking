import { describe, it, expect } from '@jest/globals';
import { buildPlatformAlerts, daysBetween } from '@/lib/billing/platformAlerts';

/**
 * Every alert here describes something that breaks nothing and throws nothing.
 * The severity rules are the whole product: if the Meta payment deadline is
 * ranked the same as a stale FX reading, the important one gets scrolled past.
 */

const BASE = {
  rateCard: [],
  meteringMode: 'shadow' as const,
  rateConfigured: true,
  paymentMethodOnFile: true,
  gatewayPhoneSet: true,
  now: new Date('2026-09-08T00:00:00Z'),
};

describe('buildPlatformAlerts', () => {
  it('is silent when everything is in order', () => {
    expect(buildPlatformAlerts(BASE)).toEqual([]);
  });

  it('raises the Meta payment method, and escalates inside two weeks', () => {
    const far = buildPlatformAlerts({
      ...BASE, paymentMethodOnFile: false, now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(far[0].severity).toBe('warning');

    const near = buildPlatformAlerts({
      ...BASE, paymentMethodOnFile: false, now: new Date('2026-09-25T00:00:00Z'),
    });
    // Every tenant goes silent at once if this is missed; it must outrank drift.
    expect(near[0].severity).toBe('critical');
    expect(near[0].title).toContain('day');
  });

  it('says overdue rather than counting down past the deadline', () => {
    const [alert] = buildPlatformAlerts({
      ...BASE, paymentMethodOnFile: false, now: new Date('2026-10-05T00:00:00Z'),
    });
    expect(alert.severity).toBe('critical');
    expect(alert.title).toContain('overdue');
    expect(alert.message).toContain('already');
  });

  it('is critical when still in shadow mode after the cutover', () => {
    const alerts = buildPlatformAlerts({
      ...BASE, meteringMode: 'shadow', now: new Date('2026-10-02T00:00:00Z'),
    });
    const a = alerts.find((x) => x.id === 'metering_shadow_after_cutover');
    expect(a?.severity).toBe('critical');
    // Absorbed cost is the point: it is not "not working yet", it is money.
    expect(a?.message).toContain('absorbed');
  });

  it('does not nag about shadow mode before the cutover', () => {
    const alerts = buildPlatformAlerts({ ...BASE, meteringMode: 'shadow' });
    expect(alerts.find((x) => x.id === 'metering_shadow_after_cutover')).toBeUndefined();
  });

  it('flags live metering running on the fallback rate', () => {
    const alerts = buildPlatformAlerts({
      ...BASE, meteringMode: 'live', rateConfigured: false, now: new Date('2026-10-02T00:00:00Z'),
    });
    expect(alerts.some((x) => x.id === 'metering_live_no_rate')).toBe(true);
  });

  it('passes rate-card warnings through with a usable title', () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      rateCard: [{
        kind: 'quarter_unconfirmed',
        effectiveOn: '2027-01-01',
        message: 'nothing dated for the next quarter',
      }],
    });
    const a = alerts.find((x) => x.id === 'rate_card_quarter_unconfirmed');
    expect(a?.title).toContain('2027-01-01');
    expect(a?.action).toContain('message_rate_card');
  });

  it('sorts critical above warning so the worst thing is read first', () => {
    const alerts = buildPlatformAlerts({
      ...BASE,
      paymentMethodOnFile: false,
      now: new Date('2026-09-25T00:00:00Z'),
      rateCard: [{ kind: 'fx_stale', message: 'stale' }],
    });
    expect(alerts.map((a) => a.severity)).toEqual(['critical', 'warning']);
  });
});

describe('daysBetween', () => {
  it('counts forward and goes negative once the date has passed', () => {
    expect(daysBetween(new Date('2026-09-08T00:00:00Z'), new Date('2026-09-30T00:00:00Z'))).toBe(22);
    expect(daysBetween(new Date('2026-10-05T00:00:00Z'), new Date('2026-09-30T00:00:00Z'))).toBeLessThan(0);
  });
});

describe('gateway phone', () => {
  it('warns when it is unset, because activation still succeeds without it', () => {
    // The Evolution-era fallback was removed, so an unset variable now means
    // every chat-onboarded tenant gets no booking link and nothing else says so.
    const alerts = buildPlatformAlerts({ ...BASE, gatewayPhoneSet: false });
    const a = alerts.find((x) => x.id === 'gateway_phone_missing');
    expect(a).toBeDefined();
    expect(a!.action).toContain('BOOKA_GATEWAY_PHONE');
  });

  it('is silent once it is set', () => {
    expect(buildPlatformAlerts({ ...BASE, gatewayPhoneSet: true })).toEqual([]);
  });
});
