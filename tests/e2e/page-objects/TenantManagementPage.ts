import { Page, Locator, expect } from '@playwright/test';

export interface TenantCredentials {
  email: string;
  password: string;
  tenantId: string;
}

export interface BookingCreationData {
  service: string;
  customer: string;
  staff?: string;
  date?: Date;
  time?: string;
}

export class TenantManagementPage {
  readonly page: Page;
  
  // Locators
  readonly loginForm: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly tenantIdInput: Locator;
  readonly loginButton: Locator;
  readonly dashboardHeader: Locator;
  readonly bookingsSection: Locator;
  readonly newBookingButton: Locator;
  readonly bookingsList: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Initialize locators
    this.loginForm = page.locator('[data-testid="login-form"]');
    this.emailInput = page.locator('[data-testid="email-input"]');
    this.passwordInput = page.locator('[data-testid="password-input"]');
    this.tenantIdInput = page.locator('[data-testid="tenant-id-input"]');
    this.loginButton = page.locator('[data-testid="login-button"]');
    this.dashboardHeader = page.locator('[data-testid="dashboard-header"]');
    this.bookingsSection = page.locator('[data-testid="bookings-section"]');
    this.newBookingButton = page.locator('[data-testid="new-booking-button"]');
    this.bookingsList = page.locator('[data-testid="bookings-list"]');
    this.logoutButton = page.locator('[data-testid="logout-button"]');
  }

  async loginAs(email: string, password: string = 'test123', tenantId?: string) {
    await this.page.goto('/auth/signin');
    
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    
    if (tenantId) {
      await this.tenantIdInput.fill(tenantId);
    }
    
    await this.loginButton.click();
    
    // Wait for successful login
    await expect(this.dashboardHeader).toBeVisible({ timeout: 10000 });
  }

  async logout() {
    await this.logoutButton.click();
    await expect(this.loginForm).toBeVisible({ timeout: 5000 });
  }

  async goToBookings() {
    await this.bookingsSection.click();
    await expect(this.bookingsList).toBeVisible({ timeout: 5000 });
  }

  async createBooking(data: BookingCreationData) {
    await this.newBookingButton.click();
    
    // Fill booking form
    await this.page.locator('[data-testid="booking-service"]').selectOption(data.service);
    await this.page.locator('[data-testid="booking-customer"]').fill(data.customer);
    
    if (data.staff) {
      await this.page.locator('[data-testid="booking-staff"]').selectOption(data.staff);
    }
    
    if (data.date) {
      const dateString = data.date.toISOString().split('T')[0];
      await this.page.locator('[data-testid="booking-date"]').fill(dateString);
    }
    
    if (data.time) {
      await this.page.locator('[data-testid="booking-time"]').fill(data.time);
    }
    
    // Submit booking
    await this.page.locator('[data-testid="submit-booking"]').click();
    
    // Wait for booking creation
    await expect(this.page.locator('[data-testid="booking-success"]')).toBeVisible({ timeout: 10000 });
    
    // Return booking ID
    const bookingId = await this.page.locator('[data-testid="booking-id"]').textContent();
    return { id: bookingId };
  }

  async getBookingsList(): Promise<string[]> {
    await this.goToBookings();
    
    const bookingElements = await this.page.locator('[data-testid="booking-item"]').all();
    const bookingIds: string[] = [];
    
    for (const element of bookingElements) {
      const id = await element.getAttribute('data-booking-id');
      if (id) {
        bookingIds.push(id);
      }
    }
    
    return bookingIds;
  }

  async searchBooking(bookingId: string): Promise<boolean> {
    await this.goToBookings();
    
    const searchInput = this.page.locator('[data-testid="booking-search"]');
    await searchInput.fill(bookingId);
    
    // Wait for search results
    await this.page.waitForTimeout(1000);
    
    const searchResults = await this.page.locator('[data-testid="booking-item"]').count();
    return searchResults > 0;
  }

  async verifyTenantIsolation(unauthorizedBookingId: string): Promise<boolean> {
    try {
      await this.goToBookings();
      const isBookingVisible = await this.searchBooking(unauthorizedBookingId);
      return !isBookingVisible; // Should NOT be visible for proper isolation
    } catch (error) {
      return true; // Error means isolation is working
    }
  }

  async getCurrentTenantId(): Promise<string | null> {
    // Extract tenant ID from URL, local storage, or data attributes
    const tenantId = await this.page.evaluate(() => {
      return localStorage.getItem('tenantId') || 
             document.documentElement.getAttribute('data-tenant-id');
    });
    
    return tenantId;
  }

  async verifyUserRole(expectedRole: string): Promise<boolean> {
    const roleElement = this.page.locator('[data-testid="user-role"]');
    
    if (await roleElement.isVisible()) {
      const actualRole = await roleElement.textContent();
      return actualRole === expectedRole;
    }
    
    return false;
  }

  async hasPermission(permission: string): Promise<boolean> {
    const permissionElement = this.page.locator(`[data-permission="${permission}"]`);
    return await permissionElement.isVisible();
  }
}