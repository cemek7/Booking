import { test, expect } from '@playwright/test';
import { BookingFlowPage, tomorrow } from '../page-objects/BookingFlowPage';

test.describe('Complete Booking Flow', () => {
  let bookingPage: BookingFlowPage;

  test.beforeEach(async ({ page }) => {
    bookingPage = new BookingFlowPage(page);
  });

  test('successful booking creation and payment', async () => {
    // Navigate to booking form
    await bookingPage.goto();

    // Fill booking details
    await bookingPage.selectService('Hair Cut');
    await bookingPage.selectStaff('John Doe');
    await bookingPage.selectDateTime(tomorrow(), '14:00');
    
    await bookingPage.fillCustomerDetails({
      name: 'Test Customer',
      phone: '+234567890123',
      email: 'test@example.com'
    });
    
    // Proceed to payment
    await bookingPage.proceedToPayment();
    
    // Verify booking creation
    const bookingId = await bookingPage.getBookingId();
    expect(bookingId).toBeTruthy();
    expect(bookingId.length).toBeGreaterThan(0);
    
    // Test payment flow
    await bookingPage.selectPaymentMethod('paystack');
    await bookingPage.processPayment();
    
    // Verify successful completion
    await bookingPage.waitForBookingConfirmation();
    
    const paymentStatus = await bookingPage.getPaymentStatus();
    expect(['completed', 'successful', 'paid']).toContain(paymentStatus.toLowerCase());
  });

  test('booking conflict prevention', async () => {
    const timeSlot = '15:00';
    const date = tomorrow();
    
    // Create first booking
    const booking1Id = await bookingPage.createBooking({
      service: 'Hair Cut',
      staff: 'John Doe',
      date,
      time: timeSlot,
      customerName: 'Customer 1',
      customerPhone: '+234567890124',
      customerEmail: 'customer1@example.com'
    });
    
    expect(booking1Id).toBeTruthy();
    
    // Attempt to create second booking at the same time
    await bookingPage.goto();
    await bookingPage.selectService('Hair Cut');
    await bookingPage.selectStaff('John Doe');
    await bookingPage.selectDateTime(date, timeSlot);
    
    await bookingPage.fillCustomerDetails({
      name: 'Customer 2',
      phone: '+234567890125',
      email: 'customer2@example.com'
    });
    
    // Try to proceed - should show conflict
    await bookingPage.proceedButton.click();
    
    // Verify conflict detection
    await expect(bookingPage.conflictError).toBeVisible({ timeout: 5000 });
    
    const errorMessage = await bookingPage.getErrorMessage();
    expect(errorMessage.toLowerCase()).toMatch(/conflict|unavailable|already booked/);
  });

  test('form validation', async () => {
    await bookingPage.goto();
    
    // Try to proceed without selecting service
    await bookingPage.proceedButton.click();
    
    // Should show validation error
    const serviceError = bookingPage.page.locator('[data-testid="service-error"]');
    await expect(serviceError).toBeVisible();
    
    // Select service but skip staff
    await bookingPage.selectService('Hair Cut');
    await bookingPage.proceedButton.click();
    
    // Should show staff validation error
    const staffError = bookingPage.page.locator('[data-testid="staff-error"]');
    await expect(staffError).toBeVisible();
  });

  test('mobile responsive booking flow', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'This test is for mobile only');
    
    await bookingPage.goto();
    
    // Verify mobile layout
    const mobileMenu = page.locator('[data-testid="mobile-menu"]');
    await expect(mobileMenu).toBeVisible();
    
    // Complete mobile booking
    await bookingPage.selectService('Consultation');
    await bookingPage.selectStaff('Jane Smith');
    await bookingPage.selectDateTime(tomorrow(), '10:00');
    
    await bookingPage.fillCustomerDetails({
      name: 'Mobile Customer',
      phone: '+234567890126',
      email: 'mobile@example.com'
    });
    
    await bookingPage.proceedToPayment();
    
    // Verify mobile payment form
    const paymentForm = page.locator('[data-testid="mobile-payment-form"]');
    await expect(paymentForm).toBeVisible();
  });

  test('booking modification flow', async () => {
    // Create initial booking
    const bookingId = await bookingPage.createBooking({
      service: 'Hair Cut',
      staff: 'John Doe',
      date: tomorrow(),
      time: '11:00',
      customerName: 'Modify Customer',
      customerEmail: 'modify@example.com'
    });
    
    // Navigate to booking modification
    await bookingPage.page.goto(`/booking/${bookingId}/modify`);
    
    // Change time slot
    await bookingPage.selectDateTime(tomorrow(), '12:00');
    
    // Save changes
    await bookingPage.page.locator('[data-testid="save-changes"]').click();
    
    // Verify modification success
    await expect(bookingPage.successMessage).toBeVisible();
    
    // Verify new time is displayed
    await bookingPage.verifyBookingDetails({
      service: 'Hair Cut',
      staff: 'John Doe'
    });
  });

  test('booking cancellation flow', async () => {
    // Create booking to cancel
    const bookingId = await bookingPage.createBooking({
      service: 'Hair Cut',
      staff: 'John Doe',
      date: tomorrow(),
      time: '16:00',
      customerName: 'Cancel Customer',
      customerEmail: 'cancel@example.com'
    });
    
    // Navigate to booking details
    await bookingPage.page.goto(`/booking/${bookingId}`);
    
    // Cancel booking
    await bookingPage.page.locator('[data-testid="cancel-booking"]').click();
    
    // Confirm cancellation
    await bookingPage.page.locator('[data-testid="confirm-cancel"]').click();
    
    // Verify cancellation
    const statusElement = bookingPage.page.locator('[data-testid="booking-status"]');
    await expect(statusElement).toContainText('cancelled');
  });

  test('payment failure handling', async () => {
    await bookingPage.goto();
    
    // Create booking
    await bookingPage.selectService('Hair Cut');
    await bookingPage.selectStaff('John Doe');
    await bookingPage.selectDateTime(tomorrow(), '13:00');
    
    await bookingPage.fillCustomerDetails({
      name: 'Payment Fail Customer',
      phone: '+234567890127',
      email: 'paymentfail@example.com'
    });
    
    await bookingPage.proceedToPayment();
    
    // Select payment method
    await bookingPage.selectPaymentMethod('paystack');
    
    // Simulate payment failure
    await bookingPage.page.locator('[data-testid="test-payment-fail"]').click();
    
    // Verify error handling
    const paymentError = bookingPage.page.locator('[data-testid="payment-error"]');
    await expect(paymentError).toBeVisible();
    
    // Verify booking is still in pending state
    const bookingStatus = await bookingPage.page.locator('[data-testid="booking-status"]').textContent();
    expect(['pending', 'payment_pending']).toContain(bookingStatus?.toLowerCase());
  });
});