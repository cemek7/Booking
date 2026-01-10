/**
 * Phase 6: API Testing Framework
 * Type-safe API testing utilities with contract validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { TestDataFactory, TestUser } from './testUtils';

// API route handler type definition
export type ApiRouteHandler = (
  request: NextRequest,
  context?: { params: Record<string, string> }
) => Promise<Response | NextResponse>;

// API test configuration
export interface ApiTestConfig {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  expectedStatus?: number;
  expectedResponse?: Record<string, unknown>;
  user?: TestUser;
}

// API response validation schema
export interface ApiResponseSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, ApiResponseSchema>;
  items?: ApiResponseSchema;
  required?: string[];
  enum?: unknown[];
}

// Type-safe API testing utilities
export class ApiTestUtils {
  /**
   * Create a mock NextRequest for testing API routes
   */
  static createMockRequest(config: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    user?: TestUser;
  }): NextRequest {
    const { url, method = 'GET', headers = {}, body, user } = config;
    
    // Add authentication headers if user provided
    if (user) {
      headers['x-user-id'] = user.id;
      headers['x-user-role'] = user.role;
      headers['x-tenant-id'] = user.tenantId;
    }

    const mockRequest = {
      method,
      url,
      headers: {
        get: (name: string) => headers[name.toLowerCase()] || null,
        has: (name: string) => name.toLowerCase() in headers,
        entries: () => Object.entries(headers)[Symbol.iterator](),
        forEach: (callback: (value: string, key: string) => void) => {
          Object.entries(headers).forEach(([key, value]) => callback(value, key));
        }
      },
      json: () => Promise.resolve(body || {}),
      text: () => Promise.resolve(JSON.stringify(body || {})),
      nextUrl: new URL(url),
      cookies: {
        get: () => undefined,
        getAll: () => [],
        has: () => false,
        set: () => {},
        delete: () => {}
      }
    } as unknown as NextRequest;

    return mockRequest;
  }

  /**
   * Test API route with type-safe response validation
   */
  static async testApiRoute<T = unknown>(
    handler: ApiRouteHandler,
    config: ApiTestConfig
  ): Promise<{
    response: T;
    status: number;
    headers: Record<string, string>;
  }> {
    const mockRequest = this.createMockRequest({
      url: `http://localhost:3000${config.endpoint}`,
      method: config.method,
      headers: config.headers,
      body: config.body,
      user: config.user
    });

    const response = await handler(mockRequest);
    const responseData = await response.json() as T;
    const status = response.status;
    const headers: Record<string, string> = {};
    
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Validate expected status
    if (config.expectedStatus && status !== config.expectedStatus) {
      throw new Error(`Expected status ${config.expectedStatus}, got ${status}`);
    }

    // Validate expected response shape
    if (config.expectedResponse) {
      expect(responseData).toMatchObject(config.expectedResponse);
    }

    return {
      response: responseData,
      status,
      headers
    };
  }

  /**
   * Validate API response against schema
   */
  static validateResponseSchema(data: unknown, schema: ApiResponseSchema): boolean {
    if (schema.type === 'object') {
      if (typeof data !== 'object' || data === null) return false;
      
      const obj = data as Record<string, unknown>;
      
      // Check required properties
      if (schema.required) {
        for (const prop of schema.required) {
          if (!(prop in obj)) return false;
        }
      }
      
      // Check property types
      if (schema.properties) {
        for (const [prop, propSchema] of Object.entries(schema.properties)) {
          if (prop in obj && !this.validateResponseSchema(obj[prop], propSchema)) {
            return false;
          }
        }
      }
      
      return true;
    }
    
    if (schema.type === 'array') {
      if (!Array.isArray(data)) return false;
      
      if (schema.items) {
        return data.every(item => this.validateResponseSchema(item, schema.items!));
      }
      
      return true;
    }
    
    if (schema.enum) {
      return schema.enum.includes(data);
    }
    
    return typeof data === schema.type;
  }

  /**
   * Create test scenarios for common API patterns
   */
  static createCrudTestSuite(endpoint: string, entityName: string) {
    return {
      [`GET ${endpoint} - list ${entityName}s`]: {
        endpoint,
        method: 'GET' as const,
        expectedStatus: 200,
        expectedResponse: {
          success: true,
          data: expect.any(Array)
        }
      },
      [`POST ${endpoint} - create ${entityName}`]: {
        endpoint,
        method: 'POST' as const,
        body: TestDataFactory.createApiResponse({}),
        expectedStatus: 201,
        expectedResponse: {
          success: true,
          data: expect.objectContaining({ id: expect.any(String) })
        }
      },
      [`GET ${endpoint}/:id - get ${entityName}`]: {
        endpoint: `${endpoint}/test-id`,
        method: 'GET' as const,
        expectedStatus: 200,
        expectedResponse: {
          success: true,
          data: expect.objectContaining({ id: 'test-id' })
        }
      },
      [`PATCH ${endpoint}/:id - update ${entityName}`]: {
        endpoint: `${endpoint}/test-id`,
        method: 'PATCH' as const,
        body: { name: 'Updated Name' },
        expectedStatus: 200,
        expectedResponse: {
          success: true,
          data: expect.objectContaining({ id: 'test-id' })
        }
      },
      [`DELETE ${endpoint}/:id - delete ${entityName}`]: {
        endpoint: `${endpoint}/test-id`,
        method: 'DELETE' as const,
        expectedStatus: 204
      }
    };
  }
}

// API contract testing
export class ApiContractTests {
  /**
   * Test API endpoint conforms to OpenAPI specification
   */
  static testApiContract(
    endpoint: string,
    method: string,
    expectedSchema: ApiResponseSchema,
    testData: unknown[]
  ): void {
    describe(`API Contract: ${method} ${endpoint}`, () => {
      testData.forEach((data, index) => {
        it(`validates response schema for test case ${index + 1}`, () => {
          const isValid = ApiTestUtils.validateResponseSchema(data, expectedSchema);
          expect(isValid).toBe(true);
        });
      });
    });
  }

  /**
   * Test API error responses
   */
  static testErrorResponses(endpoint: string, method: string): void {
    describe(`API Error Handling: ${method} ${endpoint}`, () => {
      it('returns 400 for invalid request body', async () => {
        const response = await fetch(`http://localhost:3000${endpoint}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invalid: 'data' })
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data).toHaveProperty('error');
      });

      it('returns 401 for unauthorized access', async () => {
        const response = await fetch(`http://localhost:3000${endpoint}`, {
          method
        });

        expect([401, 403]).toContain(response.status);
      });

      it('returns 404 for non-existent resources', async () => {
        const response = await fetch(`http://localhost:3000${endpoint}/non-existent-id`, {
          method: 'GET'
        });

        expect(response.status).toBe(404);
      });
    });
  }
}

// Integration testing utilities
export class IntegrationTestUtils {
  /**
   * Test complete workflow with multiple API calls
   */
  static async testWorkflow(
    name: string,
    steps: Array<{
      name: string;
      action: () => Promise<unknown>;
      validation: (result: unknown) => void;
    }>
  ): Promise<void> {
    console.log(`Starting workflow test: ${name}`);
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`  Step ${i + 1}: ${step.name}`);
      
      try {
        const result = await step.action();
        step.validation(result);
        console.log(`  ✓ Step ${i + 1} completed successfully`);
      } catch (error) {
        console.error(`  ✗ Step ${i + 1} failed:`, error);
        throw new Error(`Workflow "${name}" failed at step ${i + 1}: ${step.name}`);
      }
    }
    
    console.log(`✓ Workflow "${name}" completed successfully`);
  }

  /**
   * Create booking workflow test
   */
  static createBookingWorkflowTest(user: TestUser) {
    const booking = TestDataFactory.createBooking({ tenantId: user.tenantId });
    
    return this.testWorkflow('Create Booking Workflow', [
      {
        name: 'Check availability',
        action: async () => {
          const response = await fetch('/api/bookings/availability', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id,
              'x-tenant-id': user.tenantId
            },
            body: JSON.stringify({
              serviceId: booking.serviceId,
              startAt: booking.startAt,
              endAt: booking.endAt
            })
          });
          return response.json();
        },
        validation: (result: unknown) => {
          expect(result).toHaveProperty('available', true);
        }
      },
      {
        name: 'Create booking',
        action: async () => {
          const response = await fetch('/api/bookings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id,
              'x-tenant-id': user.tenantId
            },
            body: JSON.stringify(booking)
          });
          return response.json();
        },
        validation: (result: unknown) => {
          expect(result).toHaveProperty('success', true);
          expect(result).toHaveProperty('data');
        }
      },
      {
        name: 'Send confirmation',
        action: async () => {
          const response = await fetch(`/api/bookings/${booking.id}/confirm`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id,
              'x-tenant-id': user.tenantId
            }
          });
          return response.json();
        },
        validation: (result: unknown) => {
          expect(result).toHaveProperty('success', true);
        }
      }
    ]);
  }
}

// Performance testing for APIs
export class ApiPerformanceTests {
  /**
   * Load test API endpoint
   */
  static async loadTestEndpoint(
    endpoint: string,
    options: {
      requests: number;
      concurrency: number;
      method?: string;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    }
  ): Promise<{
    totalTime: number;
    averageTime: number;
    successfulRequests: number;
    failedRequests: number;
    requestsPerSecond: number;
  }> {
    const { requests, concurrency, method = 'GET', body, headers = {} } = options;
    const results: Array<{ success: boolean; duration: number }> = [];
    const startTime = Date.now();

    // Run requests in batches for concurrency control
    const batches = Math.ceil(requests / concurrency);
    
    for (let batch = 0; batch < batches; batch++) {
      const batchPromises: Promise<{ success: boolean; duration: number }>[] = [];
      const batchSize = Math.min(concurrency, requests - batch * concurrency);
      
      for (let i = 0; i < batchSize; i++) {
        batchPromises.push(this.makeTimedRequest(endpoint, { method, body, headers }));
      }
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const totalTime = Date.now() - startTime;
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = results.filter(r => !r.success).length;
    const averageTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    const requestsPerSecond = requests / (totalTime / 1000);

    return {
      totalTime,
      averageTime,
      successfulRequests,
      failedRequests,
      requestsPerSecond
    };
  }

  private static async makeTimedRequest(
    endpoint: string,
    options: {
      method: string;
      body?: Record<string, unknown>;
      headers: Record<string, string>;
    }
  ): Promise<{ success: boolean; duration: number }> {
    const start = Date.now();
    
    try {
      const response = await fetch(endpoint, {
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      
      const duration = Date.now() - start;
      return { success: response.ok, duration };
    } catch (error) {
      const duration = Date.now() - start;
      return { success: false, duration };
    }
  }
}

// Export commonly used schemas
export const CommonSchemas = {
  ApiResponse: {
    type: 'object' as const,
    required: ['success'],
    properties: {
      success: { type: 'boolean' as const },
      data: { type: 'object' as const },
      error: { type: 'string' as const },
      message: { type: 'string' as const }
    }
  },
  
  Booking: {
    type: 'object' as const,
    required: ['id', 'tenantId', 'customerId', 'serviceId', 'startAt', 'endAt', 'status'],
    properties: {
      id: { type: 'string' as const },
      tenantId: { type: 'string' as const },
      customerId: { type: 'string' as const },
      serviceId: { type: 'string' as const },
      staffId: { type: 'string' as const },
      startAt: { type: 'string' as const },
      endAt: { type: 'string' as const },
      status: {
        type: 'string' as const,
        enum: ['requested', 'confirmed', 'completed', 'cancelled', 'no_show']
      }
    }
  },

  User: {
    type: 'object' as const,
    required: ['id', 'email', 'role', 'tenantId'],
    properties: {
      id: { type: 'string' as const },
      email: { type: 'string' as const },
      role: {
        type: 'string' as const,
        enum: ['superadmin', 'owner', 'manager', 'staff']
      },
      tenantId: { type: 'string' as const },
      permissions: {
        type: 'array' as const,
        items: { type: 'string' as const }
      }
    }
  }
};