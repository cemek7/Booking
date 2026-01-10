/**
 * Phase 6: Integration Testing Framework
 * End-to-end workflow testing with proper type safety
 */

import { TestDataFactory, TestUser, TestBooking, TestTenant } from './testUtils';
import { MockBuilder } from './testUtils';
import { ApiTestUtils } from './apiTestUtils';

// Integration test configuration
export interface IntegrationTestConfig {
  name: string;
  description: string;
  user: TestUser;
  tenant: TestTenant;
  timeout?: number;
  setup?: () => Promise<void>;
  cleanup?: () => Promise<void>;
}

// Workflow step definition
export interface WorkflowStep {
  name: string;
  action: () => Promise<unknown>;
  validation: (result: unknown) => void | Promise<void>;
  onError?: (error: Error) => void;
  retries?: number;
}

// Integration test base class
export class IntegrationTestRunner {
  private config: IntegrationTestConfig;
  private mockFetch: jest.MockedFunction<typeof fetch>;
  private supabaseMock: any;

  constructor(config: IntegrationTestConfig) {
    this.config = config;
    this.mockFetch = MockBuilder.createFetchMock();
    this.supabaseMock = MockBuilder.createSupabaseMock();
  }

  /**
   * Run complete integration test workflow
   */
  async runWorkflow(steps: WorkflowStep[]): Promise<void> {
    console.log(`🚀 Starting integration test: ${this.config.name}`);
    
    // Setup
    if (this.config.setup) {
      await this.config.setup();
    }

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        console.log(`  📝 Step ${i + 1}: ${step.name}`);

        await this.executeStep(step, i + 1);
      }

      console.log(`✅ Integration test "${this.config.name}" completed successfully`);
    } catch (error) {
      console.error(`❌ Integration test "${this.config.name}" failed:`, error);
      throw error;
    } finally {
      // Cleanup
      if (this.config.cleanup) {
        await this.config.cleanup();
      }
    }
  }

  private async executeStep(step: WorkflowStep, stepNumber: number): Promise<void> {
    const maxRetries = step.retries || 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await step.action();
        await step.validation(result);
        
        console.log(`    ✅ Step ${stepNumber} completed successfully`);
        return;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          console.log(`    ⚠️  Step ${stepNumber} failed (attempt ${attempt}), retrying...`);
          await this.delay(1000 * attempt); // Progressive delay
        } else {
          console.error(`    ❌ Step ${stepNumber} failed after ${maxRetries} attempts`);
          
          if (step.onError) {
            step.onError(lastError);
          }
          
          throw lastError;
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Setup mock responses for the workflow
   */
  setupMockResponses(responses: Array<{
    url: string | RegExp;
    response: any;
    status?: number;
  }>): void {
    this.mockFetch = MockBuilder.createFetchMock(responses);
    (global as any).fetch = this.mockFetch;
  }

  /**
   * Verify API calls were made as expected
   */
  verifyApiCalls(expectedCalls: Array<{
    url: string | RegExp;
    method?: string;
    body?: any;
  }>): void {
    expectedCalls.forEach(({ url, method, body }) => {
      const calls = this.mockFetch.mock.calls;
      const matchingCall = calls.find(call => {
        const requestUrl = typeof call[0] === 'string' ? call[0] : call[0].url;
        const urlMatches = typeof url === 'string' 
          ? requestUrl.includes(url)
          : url.test(requestUrl);

        if (!urlMatches) return false;

        if (method) {
          const options = call[1];
          if (options?.method !== method) return false;
        }

        if (body) {
          const options = call[1];
          if (options?.body) {
            const requestBody = JSON.parse(options.body as string);
            if (!this.deepEqual(requestBody, body)) return false;
          }
        }

        return true;
      });

      expect(matchingCall).toBeDefined();
    });
  }

  private deepEqual(obj1: any, obj2: any): boolean {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }
}

// Booking workflow integration tests
export class BookingWorkflowTests {
  /**
   * Test complete booking creation workflow
   */
  static createBookingWorkflow(config: IntegrationTestConfig): IntegrationTestRunner {
    const runner = new IntegrationTestRunner(config);
    const booking = TestDataFactory.createBooking({ tenantId: config.tenant.id });

    // Setup API responses
    runner.setupMockResponses([
      {
        url: '/api/bookings/availability',
        response: { available: true, conflicts: [] }
      },
      {
        url: '/api/bookings',
        response: TestDataFactory.createApiResponse({ 
          id: booking.id,
          ...booking,
          status: 'confirmed'
        }),
        status: 201
      },
      {
        url: `/api/bookings/${booking.id}/notifications`,
        response: TestDataFactory.createApiResponse({ sent: true })
      }
    ]);

    const steps: WorkflowStep[] = [
      {
        name: 'Check service availability',
        action: async () => {
          const response = await fetch('/api/bookings/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serviceId: booking.serviceId,
              startAt: booking.startAt,
              endAt: booking.endAt,
              tenantId: booking.tenantId
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.available).toBe(true);
          expect(result.conflicts).toHaveLength(0);
        }
      },
      {
        name: 'Create booking',
        action: async () => {
          const response = await fetch('/api/bookings', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-tenant-id': booking.tenantId
            },
            body: JSON.stringify(booking)
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data).toMatchObject({
            id: booking.id,
            tenantId: booking.tenantId,
            status: 'confirmed'
          });
        }
      },
      {
        name: 'Send confirmation notifications',
        action: async () => {
          const response = await fetch(`/api/bookings/${booking.id}/notifications`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-tenant-id': booking.tenantId
            },
            body: JSON.stringify({ type: 'confirmation' })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.sent).toBe(true);
        }
      }
    ];

    // Run the workflow
    return runner;
  }

  /**
   * Test booking conflict resolution workflow
   */
  static createConflictResolutionWorkflow(config: IntegrationTestConfig): IntegrationTestRunner {
    const runner = new IntegrationTestRunner(config);
    const booking = TestDataFactory.createBooking({ tenantId: config.tenant.id });
    const conflictingBooking = TestDataFactory.createBooking({
      tenantId: config.tenant.id,
      startAt: booking.startAt,
      endAt: booking.endAt
    });

    runner.setupMockResponses([
      {
        url: '/api/bookings/availability',
        response: { 
          available: false, 
          conflicts: [conflictingBooking] 
        }
      },
      {
        url: '/api/bookings/resolve-conflict',
        response: TestDataFactory.createApiResponse({
          resolution: 'rescheduled',
          newTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        })
      }
    ]);

    const steps: WorkflowStep[] = [
      {
        name: 'Detect booking conflict',
        action: async () => {
          const response = await fetch('/api/bookings/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serviceId: booking.serviceId,
              startAt: booking.startAt,
              endAt: booking.endAt,
              tenantId: booking.tenantId
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.available).toBe(false);
          expect(result.conflicts).toHaveLength(1);
        }
      },
      {
        name: 'Resolve conflict automatically',
        action: async () => {
          const response = await fetch('/api/bookings/resolve-conflict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestedBooking: booking,
              conflicts: [conflictingBooking],
              resolution: 'reschedule'
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.resolution).toBe('rescheduled');
          expect(result.data.newTime).toBeDefined();
        }
      }
    ];

    return runner;
  }

  /**
   * Test booking cancellation workflow
   */
  static createCancellationWorkflow(config: IntegrationTestConfig): IntegrationTestRunner {
    const runner = new IntegrationTestRunner(config);
    const booking = TestDataFactory.createBooking({ 
      tenantId: config.tenant.id,
      status: 'confirmed'
    });

    runner.setupMockResponses([
      {
        url: `/api/bookings/${booking.id}`,
        response: TestDataFactory.createApiResponse(booking)
      },
      {
        url: `/api/bookings/${booking.id}/cancel`,
        response: TestDataFactory.createApiResponse({ 
          ...booking, 
          status: 'cancelled',
          cancelledAt: new Date().toISOString()
        })
      },
      {
        url: '/api/payments/refund',
        response: TestDataFactory.createApiResponse({ refunded: true })
      }
    ]);

    const steps: WorkflowStep[] = [
      {
        name: 'Verify booking exists',
        action: async () => {
          const response = await fetch(`/api/bookings/${booking.id}`);
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.status).toBe('confirmed');
        }
      },
      {
        name: 'Cancel booking',
        action: async () => {
          const response = await fetch(`/api/bookings/${booking.id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Customer request' })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.status).toBe('cancelled');
          expect(result.data.cancelledAt).toBeDefined();
        }
      },
      {
        name: 'Process refund',
        action: async () => {
          const response = await fetch('/api/payments/refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: booking.id })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.refunded).toBe(true);
        }
      }
    ];

    return runner;
  }
}

// User management workflow tests
export class UserWorkflowTests {
  /**
   * Test user registration workflow
   */
  static createRegistrationWorkflow(config: IntegrationTestConfig): IntegrationTestRunner {
    const runner = new IntegrationTestRunner(config);
    const newUser = TestDataFactory.createUser({ tenantId: config.tenant.id });

    runner.setupMockResponses([
      {
        url: '/api/auth/register',
        response: TestDataFactory.createApiResponse({ 
          user: newUser,
          token: 'mock-jwt-token'
        }),
        status: 201
      },
      {
        url: '/api/users/profile',
        response: TestDataFactory.createApiResponse(newUser)
      }
    ]);

    const steps: WorkflowStep[] = [
      {
        name: 'Register new user',
        action: async () => {
          const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: newUser.email,
              password: 'test-password',
              role: newUser.role,
              tenantId: newUser.tenantId
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.user.email).toBe(newUser.email);
          expect(result.data.token).toBeDefined();
        }
      },
      {
        name: 'Verify user profile',
        action: async () => {
          const response = await fetch('/api/users/profile', {
            headers: { 
              'Authorization': 'Bearer mock-jwt-token',
              'x-tenant-id': newUser.tenantId
            }
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data).toMatchObject({
            email: newUser.email,
            role: newUser.role,
            tenantId: newUser.tenantId
          });
        }
      }
    ];

    return runner;
  }

  /**
   * Test permission validation workflow
   */
  static createPermissionValidationWorkflow(config: IntegrationTestConfig): IntegrationTestRunner {
    const runner = new IntegrationTestRunner(config);

    runner.setupMockResponses([
      {
        url: '/api/users/permissions',
        response: TestDataFactory.createApiResponse({
          permissions: config.user.permissions,
          role: config.user.role
        })
      },
      {
        url: '/api/bookings',
        response: TestDataFactory.createApiResponse([]),
        status: config.user.permissions.includes('bookings:read') ? 200 : 403
      }
    ]);

    const steps: WorkflowStep[] = [
      {
        name: 'Fetch user permissions',
        action: async () => {
          const response = await fetch('/api/users/permissions', {
            headers: { 'x-user-id': config.user.id }
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.permissions).toEqual(config.user.permissions);
        }
      },
      {
        name: 'Test permission enforcement',
        action: async () => {
          const response = await fetch('/api/bookings', {
            headers: { 'x-user-id': config.user.id }
          });
          return { status: response.status, data: await response.json() };
        },
        validation: (result: any) => {
          if (config.user.permissions.includes('bookings:read')) {
            expect(result.status).toBe(200);
            expect(result.data.success).toBe(true);
          } else {
            expect(result.status).toBe(403);
          }
        }
      }
    ];

    return runner;
  }
}

// WhatsApp integration workflow tests
export class WhatsAppWorkflowTests {
  /**
   * Test WhatsApp booking flow
   */
  static createWhatsAppBookingWorkflow(config: IntegrationTestConfig): IntegrationTestRunner {
    const runner = new IntegrationTestRunner(config);
    const customerPhone = '+1234567890';
    const booking = TestDataFactory.createBooking({ tenantId: config.tenant.id });

    runner.setupMockResponses([
      {
        url: '/api/whatsapp/webhook',
        response: TestDataFactory.createApiResponse({ processed: true })
      },
      {
        url: '/api/bookings/whatsapp',
        response: TestDataFactory.createApiResponse(booking),
        status: 201
      },
      {
        url: '/api/whatsapp/send',
        response: TestDataFactory.createApiResponse({ sent: true })
      }
    ]);

    const steps: WorkflowStep[] = [
      {
        name: 'Receive WhatsApp message',
        action: async () => {
          const response = await fetch('/api/whatsapp/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: customerPhone,
              body: 'I want to book a haircut for tomorrow at 2pm',
              tenantId: config.tenant.id
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.processed).toBe(true);
        }
      },
      {
        name: 'Process booking request',
        action: async () => {
          const response = await fetch('/api/bookings/whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerPhone,
              message: 'I want to book a haircut for tomorrow at 2pm',
              tenantId: config.tenant.id
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data).toMatchObject({
            tenantId: config.tenant.id,
            status: 'requested'
          });
        }
      },
      {
        name: 'Send confirmation message',
        action: async () => {
          const response = await fetch('/api/whatsapp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: customerPhone,
              message: `Your booking has been confirmed for ${booking.startAt}`,
              tenantId: config.tenant.id
            })
          });
          return response.json();
        },
        validation: (result: any) => {
          expect(result.success).toBe(true);
          expect(result.data.sent).toBe(true);
        }
      }
    ];

    return runner;
  }
}

// Performance monitoring during integration tests
export class IntegrationPerformanceMonitor {
  private metrics: Array<{
    step: string;
    duration: number;
    timestamp: number;
  }> = [];

  startStep(stepName: string): () => number {
    const start = performance.now();
    const timestamp = Date.now();

    return () => {
      const duration = performance.now() - start;
      this.metrics.push({
        step: stepName,
        duration,
        timestamp
      });
      return duration;
    };
  }

  getMetrics() {
    return {
      totalDuration: this.metrics.reduce((sum, m) => sum + m.duration, 0),
      averageDuration: this.metrics.length > 0 
        ? this.metrics.reduce((sum, m) => sum + m.duration, 0) / this.metrics.length 
        : 0,
      steps: this.metrics,
      slowestStep: this.metrics.reduce((slowest, current) => 
        current.duration > slowest.duration ? current : slowest, 
        this.metrics[0]
      )
    };
  }

  expectPerformanceWithin(stepName: string, maxDuration: number): void {
    const metric = this.metrics.find(m => m.step === stepName);
    if (metric) {
      expect(metric.duration).toBeLessThan(maxDuration);
    } else {
      throw new Error(`No performance metric found for step: ${stepName}`);
    }
  }
}

export {
  IntegrationTestRunner,
  BookingWorkflowTests,
  UserWorkflowTests,
  WhatsAppWorkflowTests,
  IntegrationPerformanceMonitor
};