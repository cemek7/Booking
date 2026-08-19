/**
 * Supabase Mock Client Library
 * 
 * Provides type-safe mocks for Supabase client operations.
 * Replaces unsafe `as any` casting throughout test files.
 */

/**
 * Mock query builder for Supabase operations
 */
export class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown; operator: string }> = [];
  private selectedFields: string = '*';
  private data: unknown = null;
  private error: unknown = null;

  constructor(data: unknown = null, error: unknown = null) {
    this.data = data;
    this.error = error;
  }

  /**
   * SELECT operation
   */
  select(fields?: string): this {
    this.selectedFields = fields || '*';
    return this;
  }

  /**
   * INSERT operation
   */
  insert(data: unknown): this {
    this.data = Array.isArray(data) ? data : [data];
    return this;
  }

  /**
   * UPDATE operation
   */
  update(data: unknown): this {
    this.data = data;
    return this;
  }

  /**
   * DELETE operation
   */
  delete(): this {
    this.data = null;
    return this;
  }

  /**
   * WHERE clause - equality
   */
  eq(field: string, value: unknown): this {
    this.filters.push({ field, value, operator: 'eq' });
    return this;
  }

  /**
   * WHERE clause - not equal
   */
  neq(field: string, value: unknown): this {
    this.filters.push({ field, value, operator: 'neq' });
    return this;
  }

  /**
   * WHERE clause - greater than
   */
  gt(field: string, value: unknown): this {
    this.filters.push({ field, value, operator: 'gt' });
    return this;
  }

  /**
   * WHERE clause - less than
   */
  lt(field: string, value: unknown): this {
    this.filters.push({ field, value, operator: 'lt' });
    return this;
  }

  /**
   * WHERE clause - in array
   */
  in(field: string, values: unknown[]): this {
    this.filters.push({ field, value: values, operator: 'in' });
    return this;
  }

  /**
   * Execute query and return single record
   */
  async single(): Promise<{ data: unknown; error: unknown }> {
    if (this.error) return { data: null, error: this.error };
    const item = Array.isArray(this.data) ? this.data[0] : this.data;
    return { data: item, error: null };
  }

  /**
   * Execute query and return single record or null
   */
  async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    if (this.error) return { data: null, error: this.error };
    const item = Array.isArray(this.data) ? this.data[0] : this.data;
    return { data: item || null, error: null };
  }

  /**
   * Execute query and return array
   */
  async array(): Promise<{ data: unknown[]; error: unknown }> {
    if (this.error) return { data: [], error: this.error };
    return { data: Array.isArray(this.data) ? this.data : [this.data].filter(Boolean), error: null };
  }

  /**
   * Execute query
   */
  async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.error) return { data: null, error: this.error };
    return { data: this.data, error: null };
  }
}

/**
 * Mock Supabase table reference
 */
export class MockSupabaseTable {
  constructor(
    private tableName: string,
    private mockData: Record<string, unknown[]> = {}
  ) {}

  select(fields?: string): MockSupabaseQuery {
    const query = new MockSupabaseQuery(this.mockData[this.tableName] || [], null);
    if (fields) query.select(fields);
    return query;
  }

  insert(data: unknown): MockSupabaseQuery {
    const item = Array.isArray(data) ? data : [data];
    this.mockData[this.tableName] = [...(this.mockData[this.tableName] || []), ...item];
    return new MockSupabaseQuery(item, null);
  }

  update(data: unknown): MockSupabaseQuery {
    return new MockSupabaseQuery(data, null);
  }

  delete(): MockSupabaseQuery {
    return new MockSupabaseQuery(null, null);
  }

  upsert(data: unknown): MockSupabaseQuery {
    return new MockSupabaseQuery(data, null);
  }
}

/**
 * Mock Supabase client
 */
export class MockSupabaseClient {
  private tables: { [tableName: string]: MockSupabaseTable } = {};

  constructor(mockData: Record<string, unknown[]> = {}) {
    Object.keys(mockData).forEach((tableName) => {
      this.tables[tableName] = new MockSupabaseTable(tableName, mockData);
    });
  }

  from(tableName: string): MockSupabaseTable {
    if (!this.tables[tableName]) {
      this.tables[tableName] = new MockSupabaseTable(tableName);
    }
    return this.tables[tableName];
  }

  rpc(name: string, params?: unknown): MockSupabaseQuery {
    // Mock RPC calls
    return new MockSupabaseQuery(null, null);
  }
}

/**
 * Factory function to create mock Supabase client
 * 
 * @param mockData Object with table names as keys and arrays as values
 * @returns Mock Supabase client
 * 
 * @example
 * const mockSupabase = createMockSupabaseClient({
 *   users: [{ id: '1', email: 'test@example.com' }],
 *   tenants: [{ id: 'tenant-1', name: 'Test Tenant' }]
 * });
 * 
 * const user = await mockSupabase.from('users').select().single();
 */
export function createMockSupabaseClient(mockData: Record<string, unknown[]> = {}): MockSupabaseClient {
  return new MockSupabaseClient(mockData);
}

/**
 * Type for Supabase response
 */
export interface SupabaseResponse<T> {
  data: T | null;
  error: Error | null;
  status: number;
  statusText: string;
}

/**
 * Mock common Supabase responses
 */
export const MockResponses = {
  /**
   * Success response
   */
  success: <T,>(data: T, status: number = 200): SupabaseResponse<T> => ({
    data,
    error: null,
    status,
    statusText: 'OK',
  }),

  /**
   * Error response
   */
  error: (message: string, status: number = 500): SupabaseResponse<null> => ({
    data: null,
    error: new Error(message),
    status,
    statusText: 'Error',
  }),

  /**
   * Not found response
   */
  notFound: <T,>(): SupabaseResponse<T> => ({
    data: null,
    error: new Error('Not found'),
    status: 404,
    statusText: 'Not Found',
  }),

  /**
   * Unauthorized response
   */
  unauthorized: <T,>(): SupabaseResponse<T> => ({
    data: null,
    error: new Error('Unauthorized'),
    status: 401,
    statusText: 'Unauthorized',
  }),

  /**
   * Forbidden response
   */
  forbidden: <T,>(): SupabaseResponse<T> => ({
    data: null,
    error: new Error('Forbidden'),
    status: 403,
    statusText: 'Forbidden',
  }),
};

/**
 * Mock factory for common data types
 */
export const MockData = {
  /**
   * Create mock user
   */
  user: (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: { name: 'Test User' },
    ...overrides,
  }),

  /**
   * Create mock tenant
   */
  tenant: (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
    id: 'tenant-123',
    name: 'Test Tenant',
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  /**
   * Create mock booking
   */
  booking: (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
    id: 'booking-123',
    customer_id: 'customer-123',
    service_id: 'service-123',
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 3600000).toISOString(),
    status: 'confirmed',
    ...overrides,
  }),

  /**
   * Create mock staff
   */
  staff: (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
    id: 'staff-123',
    name: 'John Doe',
    email: 'john@example.com',
    tenant_id: 'tenant-123',
    ...overrides,
  }),

  /**
   * Create mock service
   */
  service: (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
    id: 'service-123',
    name: 'Hair Cut',
    duration_minutes: 30,
    price: 50,
    tenant_id: 'tenant-123',
    ...overrides,
  }),

  /**
   * Create mock customer
   */
  customer: (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
    id: 'customer-123',
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1234567890',
    tenant_id: 'tenant-123',
    ...overrides,
  }),
};

/**
 * Helper to compare mock data
 */
export function expectSupabaseResponse<T>(
  response: SupabaseResponse<T>,
  expectedData: T,
  expectedStatus: number = 200
) {
  expect(response.data).toEqual(expectedData);
  expect(response.status).toBe(expectedStatus);
  expect(response.error).toBeNull();
}

/**
 * Helper to compare mock errors
 */
export function expectSupabaseError(
  response: SupabaseResponse<unknown>,
  expectedMessage: string,
  expectedStatus: number = 500
) {
  expect(response.data).toBeNull();
  expect(response.error?.message).toContain(expectedMessage);
  expect(response.status).toBe(expectedStatus);
}
