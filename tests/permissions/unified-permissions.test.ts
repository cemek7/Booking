// @ts-nocheck
/**
 * Unit tests for unified permission system
 *
 * Tests the permission helpers that gate API route access.
 */

import { describe, it, expect } from '@jest/globals';
import { getAnalyticsLevel, canAccessRoute, hasPermission } from '@/types/unified-permissions';
import { getAllPermissionsForRole } from '@/types/enhanced-permissions';

describe('Unified Permission System - Unit Tests', () => {
  describe('Analytics Access Levels', () => {
    it('staff gets personal analytics access', () => {
      expect(getAnalyticsLevel('staff')).toBe('personal');
    });

    it('manager gets team analytics access', () => {
      expect(getAnalyticsLevel('manager')).toBe('team');
    });

    it('owner gets tenant analytics access', () => {
      expect(getAnalyticsLevel('owner')).toBe('tenant');
    });

    it('superadmin gets global analytics access', () => {
      expect(getAnalyticsLevel('superadmin')).toBe('global');
    });
  });

  describe('Route Access Control', () => {
    it('blocks staff from superadmin dashboard', () => {
      expect(canAccessRoute('staff', '/dashboard/superadmin')).toBe(false);
    });

    it('blocks manager from superadmin dashboard', () => {
      expect(canAccessRoute('manager', '/dashboard/superadmin')).toBe(false);
    });

    it('allows superadmin to access superadmin dashboard', () => {
      expect(canAccessRoute('superadmin', '/dashboard/superadmin')).toBe(true);
    });

    it('blocks staff from owner-only routes', () => {
      expect(canAccessRoute('staff', '/dashboard/settings')).toBe(false);
      expect(canAccessRoute('staff', '/dashboard/billing')).toBe(false);
    });

    it('allows owner to access all dashboard routes', () => {
      expect(canAccessRoute('owner', '/dashboard/settings')).toBe(true);
      expect(canAccessRoute('owner', '/dashboard/billing')).toBe(true);
      expect(canAccessRoute('owner', '/dashboard/bookings')).toBe(true);
    });

    it('unregistered routes are accessible to all', () => {
      // Routes not in the protection map are unprotected
      expect(canAccessRoute('staff', '/unknown-route')).toBe(true);
      expect(canAccessRoute('superadmin', '/some-page')).toBe(true);
    });
  });

  describe('Role Permission Inheritance (getAllPermissionsForRole)', () => {
    it('staff has own booking view permission', () => {
      const perms = getAllPermissionsForRole('staff');
      expect(perms).toContain('booking:view:own');
    });

    it('manager inherits staff permissions', () => {
      const perms = getAllPermissionsForRole('manager');
      expect(perms).toContain('booking:view:own'); // inherited from staff
      expect(perms).toContain('booking:view:all'); // manager-level
    });

    it('owner inherits manager and staff permissions', () => {
      const perms = getAllPermissionsForRole('owner');
      expect(perms).toContain('booking:view:own'); // inherited from staff
      expect(perms).toContain('booking:view:all'); // inherited from manager
      expect(perms).toContain('booking:manage:all'); // owner-level
    });

    it('superadmin has all permissions including system', () => {
      const perms = getAllPermissionsForRole('superadmin');
      expect(perms).toContain('system:manage:all');
      expect(perms).toContain('booking:manage:all');
    });

    it('manager is excluded from billing:manage:all', () => {
      const perms = getAllPermissionsForRole('manager');
      expect(perms).not.toContain('billing:manage:all');
    });

    it('owner is excluded from system:manage:all', () => {
      const perms = getAllPermissionsForRole('owner');
      expect(perms).not.toContain('system:manage:all');
    });
  });
});
