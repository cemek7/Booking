/**
 * Phase 6: Type-Safe Testing Framework Utilities
 * Comprehensive test utilities with proper TypeScript support
 */

import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent, { UserEvent } from '@testing-library/user-event';
import { SupabaseClient } from '@supabase/supabase-js';

// Type-safe mock interfaces
export interface MockSupabaseClient {
  auth: {
    getSession: jest.MockedFunction<() => Promise<{ data: { session: any } }>>;
    signInWithPassword: jest.MockedFunction<(credentials: any) => Promise<any>>;
    signOut: jest.MockedFunction<() => Promise<any>>;
    onAuthStateChange: jest.MockedFunction<(callback: any) => any>;
  };
  from: jest.MockedFunction<(table: string) => MockQueryBuilder>;
  channel: jest.MockedFunction<(channel: string) => any>;
}

export interface MockQueryBuilder {
  select: jest.MockedFunction<(columns?: string) => MockQueryBuilder>;
  insert: jest.MockedFunction<(data: any) => MockQueryBuilder>;
  update: jest.MockedFunction<(data: any) => MockQueryBuilder>;
  delete: jest.MockedFunction<() => MockQueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: any) => MockQueryBuilder>;
  gt: jest.MockedFunction<(column: string, value: any) => MockQueryBuilder>;
  gte: jest.MockedFunction<(column: string, value: any) => MockQueryBuilder>;
  lt: jest.MockedFunction<(column: string, value: any) => MockQueryBuilder>;
  lte: jest.MockedFunction<(column: string, value: any) => MockQueryBuilder>;
  order: jest.MockedFunction<(column: string, options?: any) => MockQueryBuilder>;
  limit: jest.MockedFunction<(count: number) => MockQueryBuilder>;
  maybeSingle: jest.MockedFunction<() => Promise<{ data: any; error: any }>>;
  single: jest.MockedFunction<() => Promise<{ data: any; error: any }>>;
}

// Test data factories with proper typing
export interface TestUser {
  id: string;
  email: string;
  role: 'superadmin' | 'owner' | 'manager' | 'staff';
  tenantId: string;
  permissions: string[];
}

export interface TestBooking {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  staffId?: string;
  startAt: string;
  endAt: string;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  metadata?: Record<string, unknown>;
}

export interface TestTenant {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  status: 'active' | 'suspended' | 'inactive';
  createdAt: string;
}

// Test factories
export class TestDataFactory {
  static createUser(overrides: Partial<TestUser> = {}): TestUser {
    return {
      id: `user-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      email: `test-${Date.now()}@example.com`,
      role: 'staff',
      tenantId: `tenant-${Date.now()}`,
      permissions: ['bookings:read', 'bookings:write'],
      ...overrides
    };
  }

  static createBooking(overrides: Partial<TestBooking> = {}): TestBooking {
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour later

    return {
      id: `booking-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      tenantId: `tenant-${Date.now()}`,
      customerId: `customer-${Date.now()}`,
      serviceId: `service-${Date.now()}`,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: 'requested',
      ...overrides
    };
  }

  static createTenant(overrides: Partial<TestTenant> = {}): TestTenant {
    return {
      id: `tenant-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      name: `Test Tenant ${Date.now()}`,
      metadata: { vertical: 'beauty', timezone: 'UTC' },
      status: 'active',
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createApiResponse<T>(data: T, overrides: { success?: boolean; error?: string } = {}) {
    return {
      success: true,
      data,
      error: null,
      ...overrides
    };
  }
}

// Enhanced render function with providers
interface CustomRenderOptions extends RenderOptions {
  queryClient?: QueryClient;
  user?: TestUser;
  initialRoutes?: string[];
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult & { user: UserEvent; queryClient: QueryClient } {
  const { queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0
      },
      mutations: {
        retry: false
      }
    }
  }), ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  const renderResult = render(ui, { wrapper: Wrapper, ...renderOptions });
  const user = userEvent.setup();

  return {
    ...renderResult,
    user,
    queryClient
  };
}

// Mock builders for different scenarios
export class MockBuilder {
  static createSupabaseMock(): MockSupabaseClient {
    const mockQueryBuilder: MockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null })
    };

    return {
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInWithPassword: jest.fn().mockResolvedValue({ data: { user: {} }, error: null }),
        signOut: jest.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: jest.fn().mockReturnValue({ unsubscribe: jest.fn() })
      },
      from: jest.fn().mockReturnValue(mockQueryBuilder),
      channel: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockReturnThis(),
        unsubscribe: jest.fn().mockReturnThis()
      })
    };
  }

  static createFetchMock(responses: Array<{ url?: string | RegExp; response: any; status?: number }> = []) {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    
    responses.forEach(({ url, response, status = 200 }) => {
      if (url) {
        fetchMock.mockImplementationOnce((input) => {
          const requestUrl = typeof input === 'string' ? input : input.url;
          if (typeof url === 'string' ? requestUrl.includes(url) : url.test(requestUrl)) {
            return Promise.resolve({
              ok: status >= 200 && status < 300,
              status,
              json: () => Promise.resolve(response),
              text: () => Promise.resolve(JSON.stringify(response))
            } as Response);
          }
          return Promise.reject(new Error(`Unexpected fetch call to ${requestUrl}`));
        });
      } else {
        fetchMock.mockResolvedValueOnce({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(response),
          text: () => Promise.resolve(JSON.stringify(response))
        } as Response);
      }
    });

    return fetchMock;
  }
}

// Type-safe test assertions
export class TestAssertions {
  static async waitForApiCall(
    mockFetch: jest.MockedFunction<typeof fetch>,
    expectedUrl: string | RegExp,
    timeout = 5000
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const calls = mockFetch.mock.calls;
      const found = calls.some(call => {
        const url = typeof call[0] === 'string' ? call[0] : call[0].url;
        return typeof expectedUrl === 'string' 
          ? url.includes(expectedUrl)
          : expectedUrl.test(url);
      });
      
      if (found) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error(`Expected API call to ${expectedUrl} within ${timeout}ms`);
  }

  static expectApiCallWith(
    mockFetch: jest.MockedFunction<typeof fetch>,
    expectedUrl: string | RegExp,
    expectedOptions?: Partial<RequestInit>
  ): void {
    const calls = mockFetch.mock.calls;
    const matchingCall = calls.find(call => {
      const url = typeof call[0] === 'string' ? call[0] : call[0].url;
      return typeof expectedUrl === 'string' 
        ? url.includes(expectedUrl)
        : expectedUrl.test(url);
    });

    expect(matchingCall).toBeDefined();
    
    if (expectedOptions && matchingCall) {
      const [, options] = matchingCall;
      Object.entries(expectedOptions).forEach(([key, value]) => {
        expect(options?.[key as keyof RequestInit]).toEqual(value);
      });
    }
  }
}

// Test environment helpers
export class TestEnvironment {
  static setupAuthenticatedUser(user: TestUser): void {
    // Mock the auth context
    jest.doMock('@/lib/auth/server-auth', () => ({
      requireAuth: jest.fn().mockResolvedValue(user),
      hasPermission: jest.fn().mockImplementation(
        (authUser: TestUser, permission: string) => 
          authUser.permissions.includes(permission)
      ),
      validateTenantAccess: jest.fn().mockImplementation(
        (authUser: TestUser, tenantId: string) => 
          authUser.role === 'superadmin' || authUser.tenantId === tenantId
      )
    }));
  }

  static mockEnvironmentVariables(envVars: Record<string, string>): void {
    Object.entries(envVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
  }

  static cleanupEnvironmentVariables(envVars: string[]): void {
    envVars.forEach(key => {
      delete process.env[key];
    });
  }
}

// Performance testing utilities
export class PerformanceTestUtils {
  static async measureRenderTime<T>(
    renderFn: () => Promise<T> | T
  ): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await renderFn();
    const duration = performance.now() - start;
    
    return { result, duration };
  }

  static expectRenderTimeUnder(duration: number, threshold: number): void {
    expect(duration).toBeLessThan(threshold);
  }
}

// Export commonly used testing utilities
export {
  render,
  screen,
  waitFor,
  fireEvent,
  act
} from '@testing-library/react';

export {
  userEvent
} from '@testing-library/user-event';

// Type-safe custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toHaveApiCall(url: string | RegExp): R;
      toBeValidBooking(): R;
      toHavePermission(permission: string): R;
    }
  }
}

// Custom Jest matchers
expect.extend({
  toHaveApiCall(mockFetch: jest.MockedFunction<typeof fetch>, expectedUrl: string | RegExp) {
    const calls = mockFetch.mock.calls;
    const found = calls.some(call => {
      const url = typeof call[0] === 'string' ? call[0] : call[0].url;
      return typeof expectedUrl === 'string' 
        ? url.includes(expectedUrl)
        : expectedUrl.test(url);
    });

    return {
      message: () => `Expected fetch to ${found ? 'not ' : ''}have been called with URL matching ${expectedUrl}`,
      pass: found
    };
  },

  toBeValidBooking(booking: unknown) {
    const isValid = typeof booking === 'object' && 
      booking !== null &&
      'id' in booking &&
      'tenantId' in booking &&
      'startAt' in booking &&
      'endAt' in booking;

    return {
      message: () => `Expected ${JSON.stringify(booking)} to ${isValid ? 'not ' : ''}be a valid booking`,
      pass: isValid
    };
  },

  toHavePermission(user: TestUser, permission: string) {
    const hasPermission = user.permissions.includes(permission);

    return {
      message: () => `Expected user to ${hasPermission ? 'not ' : ''}have permission ${permission}`,
      pass: hasPermission
    };
  }
});