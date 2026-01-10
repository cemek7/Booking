/**
 * Example Test Implementations using the Phase 6 Testing Framework
 * 
 * This file demonstrates how to use the comprehensive testing utilities
 * created in Phase 6 to write maintainable, type-safe tests.
 */

import { TestDataFactory, MockBuilder, renderWithProviders } from '@/test/testUtils';
import { ApiTestUtils, ApiContractTests } from '@/test/apiTestUtils';
import { FormTestUtils, CalendarTestUtils } from '@/test/componentTestUtils';
import { IntegrationTestRunner } from '@/test/integrationTestUtils';
import type { User, Booking, Service } from '@/types';

// ========================================
// UNIT TEST EXAMPLES
// ========================================

describe('TestDataFactory Examples', () => {
  it('should create realistic user data with optional overrides', () => {
    const user = TestDataFactory.createUser({
      role: 'business',
      businessName: 'Test Spa'
    });

    expect(user).toMatchObject({
      role: 'business',
      businessName: 'Test Spa',
      email: expect.stringMatching(/^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/),
      phoneNumber: expect.stringMatching(/^\+\d{1,3}\d{7,14}$/)
    });
  });

  it('should generate bookings with proper relationships', () => {
    const user = TestDataFactory.createUser();
    const service = TestDataFactory.createService();
    
    const booking = TestDataFactory.createBooking({
      userId: user.id,
      serviceId: service.id,
      status: 'confirmed'
    });

    expect(booking).toEqual(
      expect.objectContaining({
        userId: user.id,
        serviceId: service.id,
        status: 'confirmed',
        totalAmount: expect.any(Number),
        scheduledAt: expect.any(Date)
      })
    );
  });
});

describe('MockBuilder Examples', () => {
  it('should build complex mocks with chaining', () => {
    const mockApiResponse = new MockBuilder()
      .withUser({ role: 'admin' })
      .withBookings(3)
      .withAnalytics()
      .build();

    expect(mockApiResponse.user.role).toBe('admin');
    expect(mockApiResponse.bookings).toHaveLength(3);
    expect(mockApiResponse.analytics).toMatchObject({
      totalBookings: expect.any(Number),
      revenue: expect.any(Number)
    });
  });

  it('should handle error scenarios', () => {
    const errorResponse = new MockBuilder()
      .withError('VALIDATION_ERROR', 'Invalid booking data')
      .build();

    expect(errorResponse.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid booking data'
    });
  });
});

// ========================================
// API TEST EXAMPLES
// ========================================

describe('API Testing Examples', () => {
  let apiUtils: ApiTestUtils;

  beforeEach(() => {
    apiUtils = new ApiTestUtils({
      baseURL: 'http://localhost:3000/api',
      timeout: 5000
    });
  });

  describe('Booking API', () => {
    it('should create booking with proper validation', async () => {
      const bookingData = TestDataFactory.createBooking();
      
      const response = await apiUtils.post('/bookings', bookingData);
      
      // Test response structure
      await apiUtils.validateResponse(response, {
        status: 201,
        schema: {
          type: 'object',
          required: ['id', 'userId', 'serviceId', 'status'],
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            serviceId: { type: 'string' },
            status: { enum: ['pending', 'confirmed', 'cancelled'] }
          }
        }
      });

      // Test business logic
      expect(response.data).toMatchObject({
        userId: bookingData.userId,
        serviceId: bookingData.serviceId,
        status: 'pending' // New bookings start as pending
      });
    });

    it('should handle validation errors properly', async () => {
      const invalidBooking = { /* missing required fields */ };
      
      const response = await apiUtils.post('/bookings', invalidBooking, {
        expectError: true
      });

      expect(response.status).toBe(400);
      expect(response.data).toMatchObject({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.any(Array)
        })
      });
    });
  });

  describe('API Contract Testing', () => {
    it('should validate all booking endpoints meet contract', async () => {
      const contractTests = new ApiContractTests(apiUtils);
      
      const results = await contractTests.validateBookingEndpoints();
      
      expect(results.passed).toBe(true);
      expect(results.violations).toHaveLength(0);
      
      // Detailed contract validation
      results.endpoints.forEach(endpoint => {
        expect(endpoint.responseTime).toBeLessThan(2000);
        expect(endpoint.security).toMatchObject({
          authenticated: true,
          authorized: true
        });
      });
    });
  });
});

// ========================================
// COMPONENT TEST EXAMPLES
// ========================================

describe('Component Testing Examples', () => {
  describe('BookingForm Component', () => {
    it('should handle form submission with validation', async () => {
      const mockOnSubmit = jest.fn();
      const services = [TestDataFactory.createService()];
      
      const { getByRole, getByLabelText } = renderWithProviders(
        <BookingForm services={services} onSubmit={mockOnSubmit} />
      );

      const formUtils = new FormTestUtils({ getByRole, getByLabelText });

      // Fill out form
      await formUtils.fillField('Service', services[0].name);
      await formUtils.fillDateField('Preferred Date', '2024-01-15');
      await formUtils.fillTimeField('Preferred Time', '10:00');
      await formUtils.fillField('Notes', 'Test booking notes');

      // Submit form
      await formUtils.submitForm();

      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: services[0].id,
          preferredDate: '2024-01-15',
          preferredTime: '10:00:00',
          notes: 'Test booking notes'
        })
      );
    });

    it('should show validation errors for required fields', async () => {
      const { getByRole, findByText } = renderWithProviders(
        <BookingForm services={[]} onSubmit={jest.fn()} />
      );

      const formUtils = new FormTestUtils({ getByRole });

      // Submit empty form
      await formUtils.submitForm();

      // Check for validation errors
      expect(await findByText('Service is required')).toBeInTheDocument();
      expect(await findByText('Date is required')).toBeInTheDocument();
    });
  });

  describe('Calendar Component', () => {
    it('should display bookings and handle date selection', async () => {
      const bookings = [
        TestDataFactory.createBooking({ 
          scheduledAt: new Date('2024-01-15T10:00:00') 
        })
      ];

      const mockOnDateSelect = jest.fn();
      
      const { container } = renderWithProviders(
        <CalendarView bookings={bookings} onDateSelect={mockOnDateSelect} />
      );

      const calendarUtils = new CalendarTestUtils(container);

      // Check booking is displayed
      expect(calendarUtils.getBookingCount('2024-01-15')).toBe(1);

      // Select a date
      await calendarUtils.selectDate('2024-01-20');
      
      expect(mockOnDateSelect).toHaveBeenCalledWith(new Date('2024-01-20'));
    });
  });
});

// ========================================
// INTEGRATION TEST EXAMPLES
// ========================================

describe('Integration Testing Examples', () => {
  let runner: IntegrationTestRunner;

  beforeAll(async () => {
    runner = new IntegrationTestRunner({
      database: 'test',
      resetBetweenTests: true
    });
    await runner.setup();
  });

  afterAll(async () => {
    await runner.cleanup();
  });

  describe('Complete Booking Workflow', () => {
    it('should handle end-to-end booking creation', async () => {
      const user = await runner.createUser({
        role: 'customer',
        email: 'test@example.com'
      });

      const business = await runner.createUser({
        role: 'business',
        businessName: 'Test Spa'
      });

      const service = await runner.createService({
        businessId: business.id,
        name: 'Massage Therapy',
        duration: 60,
        price: 10000 // $100.00
      });

      // Customer creates booking
      const booking = await runner.createBooking({
        userId: user.id,
        serviceId: service.id,
        scheduledAt: new Date('2024-01-15T10:00:00')
      });

      // Business confirms booking
      const confirmedBooking = await runner.confirmBooking(booking.id, {
        confirmedBy: business.id
      });

      // Verify workflow completion
      expect(confirmedBooking).toMatchObject({
        status: 'confirmed',
        confirmedAt: expect.any(Date),
        confirmedBy: business.id
      });

      // Verify notifications were sent
      const notifications = await runner.getNotifications(user.id);
      expect(notifications).toContainEqual(
        expect.objectContaining({
          type: 'booking_confirmed',
          bookingId: booking.id
        })
      );
    });

    it('should handle booking cancellation with refund', async () => {
      const { user, booking } = await runner.createBookingScenario({
        status: 'confirmed',
        paymentStatus: 'paid'
      });

      // Cancel booking
      const cancelledBooking = await runner.cancelBooking(booking.id, {
        reason: 'Customer requested',
        cancelledBy: user.id
      });

      // Verify cancellation
      expect(cancelledBooking).toMatchObject({
        status: 'cancelled',
        cancelledAt: expect.any(Date),
        cancellationReason: 'Customer requested'
      });

      // Verify refund was initiated
      const payments = await runner.getPayments(booking.id);
      const refund = payments.find(p => p.type === 'refund');
      
      expect(refund).toMatchObject({
        amount: booking.totalAmount,
        status: 'processing'
      });
    });
  });

  describe('WhatsApp Integration Workflow', () => {
    it('should send booking confirmation via WhatsApp', async () => {
      const { user, booking } = await runner.createBookingScenario({
        user: { phoneNumber: '+1234567890' }
      });

      // Confirm booking (triggers WhatsApp notification)
      await runner.confirmBooking(booking.id);

      // Verify WhatsApp message was sent
      const messages = await runner.getWhatsAppMessages();
      const confirmationMessage = messages.find(m => 
        m.to === user.phoneNumber && 
        m.templateName === 'booking_confirmation'
      );

      expect(confirmationMessage).toMatchObject({
        to: user.phoneNumber,
        templateName: 'booking_confirmation',
        parameters: expect.arrayContaining([
          booking.id,
          expect.any(String), // formatted date
          expect.any(String)  // service name
        ]),
        status: 'sent'
      });
    });
  });

  describe('Performance Integration Tests', () => {
    it('should handle concurrent booking requests', async () => {
      const service = await runner.createService({
        maxConcurrentBookings: 3
      });

      // Create concurrent booking requests
      const bookingPromises = Array.from({ length: 5 }, (_, i) =>
        runner.createBooking({
          serviceId: service.id,
          scheduledAt: new Date('2024-01-15T10:00:00'),
          userId: `user-${i}`
        })
      );

      const results = await Promise.allSettled(bookingPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      // Should accept only 3 concurrent bookings
      expect(successful).toHaveLength(3);
      expect(failed).toHaveLength(2);
      
      // Verify failed requests have appropriate error
      failed.forEach(result => {
        expect(result.reason).toMatchObject({
          code: 'BOOKING_CONFLICT',
          message: expect.stringContaining('slot is full')
        });
      });
    });
  });
});

// ========================================
// PERFORMANCE TEST EXAMPLES
// ========================================

describe('Performance Testing Examples', () => {
  it('should render large datasets efficiently', async () => {
    const bookings = Array.from({ length: 1000 }, () => 
      TestDataFactory.createBooking()
    );

    const startTime = performance.now();
    
    const { container } = renderWithProviders(
      <BookingDataTable bookings={bookings} />
    );

    const renderTime = performance.now() - startTime;
    
    // Should render within performance budget
    expect(renderTime).toBeLessThan(100); // 100ms

    // Should implement virtualization for large lists
    const visibleRows = container.querySelectorAll('[role="row"]');
    expect(visibleRows.length).toBeLessThan(50); // Virtual scrolling
  });

  it('should benchmark API response times', async () => {
    const apiUtils = new ApiTestUtils();
    
    const performanceResults = await apiUtils.benchmarkEndpoint(
      '/api/bookings',
      { method: 'GET' },
      { iterations: 100 }
    );

    expect(performanceResults).toMatchObject({
      averageResponseTime: expect.any(Number),
      p95ResponseTime: expect.any(Number),
      throughput: expect.any(Number)
    });

    // Performance SLA requirements
    expect(performanceResults.averageResponseTime).toBeLessThan(200);
    expect(performanceResults.p95ResponseTime).toBeLessThan(500);
    expect(performanceResults.throughput).toBeGreaterThan(50); // requests/second
  });
});

// ========================================
// ERROR HANDLING TEST EXAMPLES
// ========================================

describe('Error Handling Examples', () => {
  it('should handle network failures gracefully', async () => {
    const { rerender } = renderWithProviders(
      <BookingForm services={[]} onSubmit={jest.fn()} />
    );

    // Simulate network error
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { getByRole } = renderWithProviders(
      <BookingForm services={[]} onSubmit={jest.fn()} />
    );

    // Should show error state
    expect(getByRole('alert')).toHaveTextContent(/unable to load services/i);

    // Should provide retry mechanism
    const retryButton = getByRole('button', { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it('should validate business rules', async () => {
    const runner = new IntegrationTestRunner();
    
    const service = await runner.createService({
      advanceBookingDays: 7 // Requires 7 days advance booking
    });

    // Try to book for tomorrow (should fail)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    await expect(
      runner.createBooking({
        serviceId: service.id,
        scheduledAt: tomorrow
      })
    ).rejects.toMatchObject({
      code: 'BOOKING_VALIDATION_ERROR',
      message: expect.stringContaining('7 days advance')
    });
  });
});

// ========================================
// SECURITY TEST EXAMPLES
// ========================================

describe('Security Testing Examples', () => {
  it('should enforce authentication on protected endpoints', async () => {
    const apiUtils = new ApiTestUtils();

    // Test without authentication
    const response = await apiUtils.get('/api/admin/users', {
      expectError: true,
      skipAuth: true
    });

    expect(response.status).toBe(401);
    expect(response.data).toMatchObject({
      error: { code: 'UNAUTHORIZED' }
    });
  });

  it('should prevent unauthorized data access', async () => {
    const runner = new IntegrationTestRunner();
    
    const user1 = await runner.createUser({ role: 'customer' });
    const user2 = await runner.createUser({ role: 'customer' });
    
    const booking = await runner.createBooking({ userId: user1.id });

    // User2 should not be able to access User1's booking
    await expect(
      runner.getBooking(booking.id, { userId: user2.id })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('access denied')
    });
  });
});

export {
  TestDataFactory,
  MockBuilder,
  ApiTestUtils,
  FormTestUtils,
  CalendarTestUtils,
  IntegrationTestRunner
};