import { describe, expect, it } from '@jest/globals';
import {
  isBookaDashboardPath,
  isProductDashboardPath,
  toBookaDashboardPath,
  toInternalDashboardPath,
  toProductDashboardPath,
} from './dashboard-path';

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

  it('leaves unrelated paths unchanged', () => {
    expect(toBookaDashboardPath('/showcase')).toBe('/showcase');
    expect(toInternalDashboardPath('/showcase')).toBe('/showcase');
    expect(isProductDashboardPath('/booka')).toBe(false);
    expect(isProductDashboardPath('/')).toBe(false);
  });
});

describe('generalized product dashboard mapping', () => {
  it('maps via the product registry (Booka)', () => {
    expect(toProductDashboardPath('booka', '/dashboard')).toBe('/booka/dashboard');
    expect(toProductDashboardPath('booka', '/dashboard/orders')).toBe('/booka/dashboard/orders');
    expect(toProductDashboardPath('booka', '/showcase')).toBe('/showcase');
  });

  it('isProductDashboardPath detects any registered product prefix', () => {
    expect(isProductDashboardPath('/booka/dashboard')).toBe(true);
    expect(isProductDashboardPath('/booka/dashboard/settings')).toBe(true);
    expect(isProductDashboardPath('/booka/auth/signin')).toBe(false);
  });
});
