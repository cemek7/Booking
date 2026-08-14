import { describe, expect, it } from '@jest/globals';
import { isBookaDashboardPath, toBookaDashboardPath, toInternalDashboardPath } from './dashboard-path';

describe('dashboard path mapping', () => {
  it('maps legacy dashboard URLs to the public Booka workspace prefix', () => {
    expect(toBookaDashboardPath('/dashboard')).toBe('/booka/dashboard');
    expect(toBookaDashboardPath('/dashboard/superadmin/staff')).toBe('/booka/dashboard/superadmin/staff');
  });

  it('maps Booka workspace URLs to internal app routes only', () => {
    expect(toInternalDashboardPath('/booka/dashboard')).toBe('/dashboard');
    expect(toInternalDashboardPath('/booka/dashboard/staff')).toBe('/dashboard/staff');
    expect(toInternalDashboardPath('/booka')).toBe('/booka');
    expect(isBookaDashboardPath('/booka/dashboard/superadmin')).toBe(true);
    expect(isBookaDashboardPath('/booka/auth/signin')).toBe(false);
  });
});
