import { test, expect } from '@playwright/test';
import { TenantManagementPage } from '../page-objects/TenantManagementPage';

test.describe('Multi-Tenant Isolation', () => {
  test('tenant data isolation verification', async ({ browser }) => {
    // Create separate contexts for different tenants
    const tenant1Context = await browser.newContext({
      storageState: undefined // Fresh state
    });
    const tenant2Context = await browser.newContext({
      storageState: undefined // Fresh state
    });
    
    const tenant1Page = await tenant1Context.newPage();
    const tenant2Page = await tenant2Context.newPage();
    
    const tenant1Management = new TenantManagementPage(tenant1Page);
    const tenant2Management = new TenantManagementPage(tenant2Page);
    
    // Login as different tenants
    await tenant1Management.loginAs('tenant1@example.com', 'password123', 'tenant-1');
    await tenant2Management.loginAs('tenant2@example.com', 'password123', 'tenant-2');
    
    // Verify tenant IDs are different
    const tenant1Id = await tenant1Management.getCurrentTenantId();
    const tenant2Id = await tenant2Management.getCurrentTenantId();
    
    expect(tenant1Id).not.toBe(tenant2Id);
    expect(tenant1Id).toBe('tenant-1');
    expect(tenant2Id).toBe('tenant-2');
    
    // Create booking in tenant 1
    const booking1 = await tenant1Management.createBooking({
      service: 'Consultation',
      customer: 'Tenant 1 Customer'
    });
    
    expect(booking1.id).toBeTruthy();
    
    // Verify booking is visible in tenant 1
    await tenant1Management.goToBookings();
    const tenant1Bookings = await tenant1Management.getBookingsList();
    expect(tenant1Bookings).toContain(booking1.id);
    
    // Verify booking is NOT visible in tenant 2
    const isIsolated = await tenant2Management.verifyTenantIsolation(booking1.id);
    expect(isIsolated).toBe(true);
    
    // Create booking in tenant 2
    const booking2 = await tenant2Management.createBooking({
      service: 'Hair Cut',
      customer: 'Tenant 2 Customer'
    });
    
    // Verify cross-tenant isolation
    const tenant1CannotSeeTenant2 = await tenant1Management.verifyTenantIsolation(booking2.id);
    expect(tenant1CannotSeeTenant2).toBe(true);
    
    // Clean up contexts
    await tenant1Context.close();
    await tenant2Context.close();
  });

  test('role-based access control', async ({ page }) => {
    const tenantPage = new TenantManagementPage(page);
    
    // Login as admin user
    await tenantPage.loginAs('admin@tenant1.com', 'admin123', 'tenant-1');
    
    // Verify admin role
    const isAdmin = await tenantPage.verifyUserRole('admin');
    expect(isAdmin).toBe(true);
    
    // Verify admin permissions
    const canManageStaff = await tenantPage.hasPermission('manage-staff');
    const canViewAnalytics = await tenantPage.hasPermission('view-analytics');
    const canManageSettings = await tenantPage.hasPermission('manage-settings');
    
    expect(canManageStaff).toBe(true);
    expect(canViewAnalytics).toBe(true);
    expect(canManageSettings).toBe(true);
    
    // Logout and login as regular user
    await tenantPage.logout();
    await tenantPage.loginAs('staff@tenant1.com', 'staff123', 'tenant-1');
    
    // Verify staff role and limited permissions
    const isStaff = await tenantPage.verifyUserRole('staff');
    expect(isStaff).toBe(true);
    
    const staffCanManageSettings = await tenantPage.hasPermission('manage-settings');
    expect(staffCanManageSettings).toBe(false);
  });

  test('api endpoint tenant isolation', async ({ request }) => {
    // Test API endpoints respect tenant isolation
    const tenant1Token = 'tenant1-jwt-token'; // Mock token
    const tenant2Token = 'tenant2-jwt-token'; // Mock token
    
    // Create booking via API for tenant 1
    const createResponse = await request.post('/api/reservations', {
      headers: {
        'Authorization': `Bearer ${tenant1Token}`,
        'x-tenant-id': 'tenant-1'
      },
      data: {
        service: 'Hair Cut',
        customer_name: 'API Test Customer',
        date: '2025-12-01',
        time: '14:00'
      }
    });
    
    expect(createResponse.ok()).toBe(true);
    const booking = await createResponse.json();
    
    // Try to access booking from different tenant
    const unauthorizedResponse = await request.get(`/api/reservations/${booking.id}`, {
      headers: {
        'Authorization': `Bearer ${tenant2Token}`,
        'x-tenant-id': 'tenant-2'
      }
    });
    
    expect(unauthorizedResponse.status()).toBe(403); // Forbidden
  });

  test('database row level security', async ({ page }) => {
    const tenantPage = new TenantManagementPage(page);
    
    // Login as tenant 1
    await tenantPage.loginAs('user@tenant1.com', 'password123', 'tenant-1');
    
    // Create booking
    const booking = await tenantPage.createBooking({
      service: 'Consultation',
      customer: 'RLS Test Customer'
    });
    
    // Verify booking is created with correct tenant_id
    await page.goto(`/api/reservations/${booking.id}`);
    
    const response = await page.waitForResponse('/api/reservations/**');
    const bookingData = await response.json();
    
    expect(bookingData.tenant_id).toBe('tenant-1');
  });

  test('session isolation between tenants', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    const tenant1Page = new TenantManagementPage(page1);
    const tenant2Page = new TenantManagementPage(page2);
    
    // Login to tenant 1
    await tenant1Page.loginAs('user@tenant1.com', 'password123', 'tenant-1');
    
    // Try to access tenant 1's data from tenant 2 session
    await page2.goto('/dashboard');
    
    // Should be redirected to login (no session sharing)
    await expect(page2).toHaveURL(/.*login.*/);
    
    // Clean up
    await context1.close();
    await context2.close();
  });

  test('tenant subdomain isolation', async ({ page }) => {
    test.skip(true, 'Subdomain testing requires DNS configuration');
    
    // This test would verify subdomain-based tenant isolation
    // e.g., tenant1.booking-app.com vs tenant2.booking-app.com
    
    await page.goto('https://tenant1.booking-app.com/dashboard');
    // Verify tenant 1 data is accessible
    
    await page.goto('https://tenant2.booking-app.com/dashboard');
    // Verify different tenant data
  });
});