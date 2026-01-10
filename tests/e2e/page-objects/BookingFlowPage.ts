import { Page, Locator, expect } from '@playwright/test';

export interface BookingDetails {
  service: string;
  staff?: string;
  date: Date;
  time: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  email: string;
  notes?: string;
}

export class BookingFlowPage {
  readonly page: Page;
  
  // Locators
  readonly serviceSelect: Locator;
  readonly staffSelect: Locator;
  readonly dateInput: Locator;
  readonly timeSlots: Locator;
  readonly customerNameInput: Locator;
  readonly customerPhoneInput: Locator;
  readonly customerEmailInput: Locator;
  readonly notesTextarea: Locator;
  readonly proceedButton: Locator;
  readonly paymentMethodSelect: Locator;
  readonly payButton: Locator;
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly conflictError: Locator;
  readonly loadingSpinner: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // Initialize locators
    this.serviceSelect = page.locator('[data-testid="service-select"]');
    this.staffSelect = page.locator('[data-testid="staff-select"]');
    this.dateInput = page.locator('[data-testid="date-input"]');
    this.timeSlots = page.locator('[data-testid="time-slot"]');
    this.customerNameInput = page.locator('[data-testid="customer-name"]');
    this.customerPhoneInput = page.locator('[data-testid="customer-phone"]');
    this.customerEmailInput = page.locator('[data-testid="customer-email"]');
    this.notesTextarea = page.locator('[data-testid="booking-notes"]');
    this.proceedButton = page.locator('[data-testid="proceed-to-payment"]');
    this.paymentMethodSelect = page.locator('[data-testid="payment-method"]');
    this.payButton = page.locator('[data-testid="pay-button"]');
    this.successMessage = page.locator('[data-testid="success-message"]');
    this.errorMessage = page.locator('[data-testid="error-message"]');
    this.conflictError = page.locator('[data-testid="conflict-error"]');
    this.loadingSpinner = page.locator('[data-testid="loading-spinner"]');
  }

  async goto() {
    await this.page.goto('/booking/new');
    await this.page.waitForLoadState('networkidle');
  }

  async selectService(serviceName: string) {
    await this.serviceSelect.click();
    await this.page.locator(`[data-testid="service-option-${serviceName}"]`).click();
    
    // Wait for staff options to load
    await this.page.waitForTimeout(500);
  }

  async selectStaff(staffName: string) {
    await this.staffSelect.click();
    await this.page.locator(`[data-testid="staff-option-${staffName}"]`).click();
    
    // Wait for time slots to load
    await this.page.waitForTimeout(500);
  }

  async selectDateTime(date: Date, time: string) {
    // Select date
    const dateString = date.toISOString().split('T')[0];
    await this.dateInput.fill(dateString);
    
    // Wait for time slots to load
    await this.page.waitForSelector('[data-testid="time-slot"]');
    
    // Select time
    await this.page.locator(`[data-testid="time-slot"][data-time="${time}"]`).click();
  }

  async fillCustomerDetails(details: CustomerDetails) {
    await this.customerNameInput.fill(details.name);
    await this.customerPhoneInput.fill(details.phone);
    await this.customerEmailInput.fill(details.email);
    
    if (details.notes) {
      await this.notesTextarea.fill(details.notes);
    }
  }

  async proceedToPayment() {
    await this.proceedButton.click();
    
    // Wait for payment form to load
    await this.page.waitForSelector('[data-testid="payment-form"]');
  }

  async selectPaymentMethod(method: 'paystack' | 'flutterwave' | 'bank-transfer') {
    await this.paymentMethodSelect.click();
    await this.page.locator(`[data-value="${method}"]`).click();
  }

  async processPayment() {
    await this.payButton.click();
    
    // Handle payment gateway redirection (for test environment)
    if (await this.page.locator('[data-testid="test-payment-form"]').isVisible()) {
      await this.page.locator('[data-testid="test-success-button"]').click();
    }
    
    // Wait for redirect back to application
    await this.page.waitForURL('**/booking/success/**');
  }

  async createBooking(details: BookingDetails): Promise<string> {
    await this.goto();
    await this.selectService(details.service);
    
    if (details.staff) {
      await this.selectStaff(details.staff);
    }
    
    await this.selectDateTime(details.date, details.time);
    
    if (details.customerName) {
      await this.fillCustomerDetails({
        name: details.customerName,
        phone: details.customerPhone || '+234567890123',
        email: details.customerEmail || 'test@example.com'
      });
    }
    
    await this.proceedToPayment();
    
    // Get booking ID before payment
    const bookingId = await this.getBookingId();
    
    return bookingId;
  }

  async getBookingId(): Promise<string> {
    // Extract booking ID from URL or data attribute
    const url = this.page.url();
    const bookingIdMatch = url.match(/booking\/([a-zA-Z0-9-]+)/);
    
    if (bookingIdMatch) {
      return bookingIdMatch[1];
    }
    
    // Alternative: get from data attribute
    const bookingElement = this.page.locator('[data-booking-id]').first();
    if (await bookingElement.isVisible()) {
      return await bookingElement.getAttribute('data-booking-id') || '';
    }
    
    throw new Error('Could not extract booking ID');
  }

  async getPaymentStatus(): Promise<string> {
    const statusElement = this.page.locator('[data-testid="payment-status"]');
    return await statusElement.textContent() || '';
  }

  async getErrorMessage(): Promise<string> {
    return await this.errorMessage.textContent() || '';
  }

  async waitForBookingConfirmation() {
    await expect(this.successMessage).toBeVisible({ timeout: 30000 });
  }

  async verifyBookingDetails(expectedDetails: Partial<BookingDetails>) {
    if (expectedDetails.service) {
      const serviceText = await this.page.locator('[data-testid="booking-service"]').textContent();
      expect(serviceText).toContain(expectedDetails.service);
    }
    
    if (expectedDetails.staff) {
      const staffText = await this.page.locator('[data-testid="booking-staff"]').textContent();
      expect(staffText).toContain(expectedDetails.staff);
    }
    
    if (expectedDetails.date && expectedDetails.time) {
      const dateTimeText = await this.page.locator('[data-testid="booking-datetime"]').textContent();
      expect(dateTimeText).toContain(expectedDetails.time);
    }
  }
}

// Utility function to get tomorrow's date
export function tomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}

// Utility function to get next week's date
export function nextWeek(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
}