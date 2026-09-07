import { describe, expect, it } from '@jest/globals';
import { getRedirectUrl } from './auth-manager';

describe('getRedirectUrl', () => {
  it('sends admins to the Booka superadmin workspace', () => {
    expect(getRedirectUrl('admin')).toBe('/booka/dashboard/superadmin');
  });

  it('sends the unknown user type to the marketing root', () => {
    expect(getRedirectUrl('unknown')).toBe('/');
  });

  it('sends tenant roles to the public Booka workspace URL (no legacy /dashboard hop)', () => {
    expect(getRedirectUrl('tenant-owner', 'owner')).toBe('/booka/dashboard');
    expect(getRedirectUrl('tenant-manager', 'manager')).toBe('/booka/dashboard?role=manager');
    expect(getRedirectUrl('tenant-staff', 'staff')).toBe('/booka/dashboard?role=staff');
  });

  it('defaults unrecognised roles to the Booka workspace base', () => {
    expect(getRedirectUrl('tenant-owner', 'somethingelse')).toBe('/booka/dashboard');
  });
});
