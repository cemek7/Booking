import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_BUSINESS_HOURS,
  businessDayKey,
  localDateTimeToUtc,
  normalizeBusinessHours,
  resolveBusinessHours,
  utcDayBounds,
} from './businessHours';

const CUSTOM_HOURS = {
  mon: { open: '10:00', close: '16:00', closed: false },
  tue: { open: '10:00', close: '16:00', closed: false },
  wed: { open: '10:00', close: '16:00', closed: false },
  thu: { open: '10:00', close: '16:00', closed: false },
  fri: { open: '10:00', close: '16:00', closed: false },
  sat: { open: null, close: null, closed: true },
  sun: { open: null, close: null, closed: true },
};

describe('business hours domain', () => {
  it('normalizes valid short and long day keys and clears times for closed days', () => {
    expect(normalizeBusinessHours({
      monday: { open: '10:00', close: '16:00', closed: false },
      tuesday: { open: '10:00', close: '16:00', closed: false },
      wednesday: { open: '10:00', close: '16:00', closed: false },
      thursday: { open: '10:00', close: '16:00', closed: false },
      friday: { open: '10:00', close: '16:00', closed: false },
      saturday: { open: '09:00', close: '12:00', closed: true },
      sunday: { open: null, close: null, closed: true },
    })).toEqual(CUSTOM_HOURS);
  });

  it.each([
    [{ mon: { open: '9am', close: '17:00', closed: false } }, 'invalid time'],
    [{ mon: { open: '17:00', close: '09:00', closed: false } }, 'reversed time'],
    [{ mon: { open: '09:00', close: null, closed: false } }, 'missing close'],
  ])('rejects an %s schedule', (value) => {
    expect(normalizeBusinessHours(value)).toBeNull();
  });

  it('prefers canonical settings, then metadata, then legacy rows', () => {
    const metadata = { business_hours: { ...CUSTOM_HOURS, mon: { open: '08:00', close: '12:00', closed: false } } };
    const legacyRows = [
      { day_of_week: 1, start_time: '07:00:00', end_time: '11:00:00' },
    ];

    expect(resolveBusinessHours({ settings: { business_hours: CUSTOM_HOURS }, metadata, legacyRows })).toEqual(CUSTOM_HOURS);
    expect(resolveBusinessHours({ settings: {}, metadata, legacyRows }).mon).toEqual({ open: '08:00', close: '12:00', closed: false });
    expect(resolveBusinessHours({ settings: {}, metadata: {}, legacyRows }).mon).toEqual({ open: '07:00', close: '11:00', closed: false });
  });

  it('uses safe weekday defaults when no stored schedule is usable', () => {
    expect(resolveBusinessHours({})).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(DEFAULT_BUSINESS_HOURS.mon).toEqual({ open: '09:00', close: '17:00', closed: false });
    expect(DEFAULT_BUSINESS_HOURS.sat).toEqual({ open: null, close: null, closed: true });
  });

  it('converts tenant-local times without using the process timezone', () => {
    expect(localDateTimeToUtc('2026-09-23', '09:00', 'Africa/Lagos')).toBe('2026-09-23T08:00:00.000Z');
    expect(localDateTimeToUtc('2026-09-23', '09:00', 'Invalid/Legacy')).toBe('2026-09-23T08:00:00.000Z');
  });

  it('rejects a nonexistent daylight-saving time', () => {
    expect(() => localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York')).toThrow(/does not exist/i);
  });

  it('chooses the earlier instant for a repeated daylight-saving time', () => {
    expect(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
  });

  it('builds DST-aware UTC day bounds and resolves the local weekday', () => {
    expect(utcDayBounds('2026-03-08', 'America/New_York')).toEqual({
      startUtc: '2026-03-08T05:00:00.000Z',
      endUtc: '2026-03-09T04:00:00.000Z',
    });
    expect(businessDayKey('2026-03-08', 'America/New_York')).toBe('sun');
  });
});
