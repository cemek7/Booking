// @ts-nocheck
// Dummy Supabase env so modules that construct a client at import time
// (e.g. createClient() at the top of conversationState.ts) don't throw
// "Invalid supabase URL" during test-file load. Real network is still mocked.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

// Optional: @testing-library/jest-dom (install if using React Testing Library)
import '@testing-library/jest-dom';

// Polyfill setImmediate for jsdom environment (used by Winston logger)
if (typeof setImmediate === 'undefined') {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(fn, 0, ...args);
  (globalThis as unknown as { clearImmediate: unknown }).clearImmediate = clearTimeout;
}

// Polyfill fetch and Web APIs for Node.js environment
import fetch, { Request, Response, Headers } from 'node-fetch';

// Bridge global Request/Response/Headers for both browser and Node environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis as any;

// Provide fetch and Web APIs globally
if (!g.fetch) {
  g.fetch = fetch;
  g.Response = Response;
  g.Headers = Headers;
}

// Wrap the global Request to inject a Bearer token automatically.
// This allows createHttpHandler({ auth: true }) routes to work in unit tests
// without needing real JWT tokens — the bearer-client mock handles auth.
// Tests that explicitly test 401 behavior should pass x-test-bypass-skip: '1'.
const OriginalRequest = Request as typeof Request;
class TestRequest extends OriginalRequest {
  constructor(input: RequestInfo, init?: RequestInit) {
    const headers = new Headers(init?.headers || {});
    if (!headers.get('authorization') && !headers.get('x-test-bypass-skip')) {
      headers.set('authorization', 'Bearer test-token');
      headers.set('x-tenant-id', headers.get('x-tenant-id') || 'test-tenant-id');
    }
    super(input as string, { ...init, headers });
  }
}
g.Request = TestRequest;

// Mock tinypool to avoid spawning workers during unit tests. Jest-style mock.
jest.mock('tinypool', () => {
  class TinyPoolStub {
    constructor(_opts?: unknown) {}
    run(_task?: unknown, _opts?: unknown) {
      return Promise.resolve(undefined);
    }
    destroy() {
      return Promise.resolve();
    }
  }
  return { TinyPool: TinyPoolStub };
});

// Provide a simple Supabase client mock for modules that call our wrapper
// functions. This avoids hitting real network and stabilizes unit tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabaseClientMock(): any {
  // Use a Proxy to allow infinite chaining without recursion.
  // When the chain is directly awaited (no terminal .single()/.maybeSingle()),
  // it resolves to { data: [], error: null } simulating an array query result.
  const chainable: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chainable, {
    get(_target, prop) {
      // Make the chain thenable: `await chain` resolves to { data: [], error: null }
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return jest.fn().mockResolvedValue({ data: null, error: null });
      }
      // All other methods (select, insert, update, eq, gte, etc.) return the same proxy
      return jest.fn().mockReturnValue(proxy);
    },
  });
  const authMock = {
    getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: jest.fn().mockResolvedValue({ data: null, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    admin: { listUsers: jest.fn().mockResolvedValue({ data: { users: [] }, error: null }) },
  };
  return {
    from: jest.fn().mockReturnValue(proxy),
    auth: authMock,
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() }),
    removeChannel: jest.fn(),
  };
  void resolved; // suppress unused warning
}

// A Supabase client mock that resolves to a default authenticated owner.
// Used for BOTH the admin client (createHttpHandler auth:true verifies the JWT +
// tenant membership via createSupabaseAdminClient) and the bearer client. Without
// the authed defaults on the admin client, every auth:true route test 401s.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAuthedClientMock(): any {
  const client = makeSupabaseClientMock();
  client.auth.getUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  const originalFrom = client.from;
  client.from = jest.fn().mockImplementation((table: string) => {
    if (table === 'tenant_users') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { tenant_id: 'test-tenant-id', role: 'owner' },
          error: null,
        }),
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ tenant_id: 'test-tenant-id', role: 'owner' }], error: null });
        },
      };
    }
    return originalFrom.call(client, table);
  });
  return client;
}

jest.mock('@/lib/supabase/server', () => {
  const client = makeSupabaseClientMock();
  return {
    getSupabaseBrowserClient: jest.fn().mockReturnValue(client),
    createServerSupabaseClient: jest.fn().mockReturnValue(client),
    getSupabaseServerComponentClient: jest.fn().mockReturnValue(client),
    getSupabaseRouteHandlerClient: jest.fn().mockReturnValue(client),
    // Admin client must default to an authenticated owner — the auth:true route
    // path verifies the JWT + tenant membership through createSupabaseAdminClient.
    createSupabaseAdminClient: jest.fn().mockReturnValue(makeAuthedClientMock()),
  };
});

jest.mock('@/lib/supabase/client', () => {
  const client = makeSupabaseClientMock();
  return {
    getSupabaseBrowserClient: jest.fn().mockReturnValue(client),
  };
});

// Mock bearer client so API routes that use createHttpHandler({ auth: true })
// get a default authenticated test user without needing real JWT tokens in tests.
jest.mock('@/lib/supabase/bearer-client', () => {
  const client = makeSupabaseClientMock();
  // Override getUser to return a default test user
  client.auth.getUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  // Override from('tenant_users') queries to return a default owner role
  const originalFrom = client.from;
  client.from = jest.fn().mockImplementation((table: string) => {
    if (table === 'tenant_users') {
      const tenantProxy = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { tenant_id: 'test-tenant-id', role: 'owner' },
          error: null,
        }),
        // Thenable for array queries
        then(resolve: (v: unknown) => void) {
          resolve({ data: [{ tenant_id: 'test-tenant-id', role: 'owner' }], error: null });
        },
      };
      return tenantProxy;
    }
    return originalFrom.call(client, table);
  });
  return {
    createSupabaseBearerClient: jest.fn().mockReturnValue(client),
  };
});

// Minimal mock for next/server so API route modules under test can import NextResponse
// without depending on Next runtime internals.
jest.mock('next/server', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  const HeadersCtor = g.Headers || class {
    // very small headers shim for tests
    map: Record<string, string> = {};
    get(k: string) { return this.map[k.toLowerCase()]; }
    set(k: string, v: string) { this.map[k.toLowerCase()] = v; }
  };
  function makeResponse(data: unknown, init?: { status?: number }) {
    const status = init?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new HeadersCtor(),
      json: async () => data,
    };
  }
  class NextRequestMock {
    url: string;
    method: string;
    headers: InstanceType<typeof HeadersCtor>;
    private _body: unknown;
    nextUrl = { searchParams: new URLSearchParams() };

    constructor(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
      this.url = url;
      this.method = init?.method ?? 'GET';
      this.headers = new HeadersCtor();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => this.headers.set(k, v));
      }
      if (!this.headers.get('authorization') && !this.headers.get('x-test-bypass-skip')) {
        this.headers.set('authorization', 'Bearer test-token');
        if (!this.headers.get('x-tenant-id')) this.headers.set('x-tenant-id', 'test-tenant-id');
      }
      this._body = init?.body;
    }

    async json() { return typeof this._body === 'string' ? JSON.parse(this._body) : this._body; }
    async text() { return typeof this._body === 'string' ? this._body : JSON.stringify(this._body); }
  }

  class NextResponseMock {
    ok: boolean;
    status: number;
    headers: InstanceType<typeof HeadersCtor>;
    private _data: unknown;

    constructor(data: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new HeadersCtor();
      this._data = data;
    }

    async json() { return this._data; }

    static json(data: unknown, init?: { status?: number }) {
      return new NextResponseMock(data, init);
    }

    static redirect(url: string) {
      return new NextResponseMock({ url }, { status: 302 });
    }

    static next() {
      return new NextResponseMock(null, { status: 200 });
    }
  }

  return {
    NextRequest: NextRequestMock,
    NextResponse: NextResponseMock,
  };
});

// Provide minimal mocks for next/navigation used by components in tests
jest.mock('next/navigation', () => {
  const params = new URLSearchParams();
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
    usePathname: () => '/',
    useSearchParams: () => params,
    redirect: (url: string) => { throw new Error(`redirect called in test: ${url}`); },
    notFound: () => { throw new Error('notFound called in test'); },
  };
});

// Provide minimal mocks for next/headers to avoid runtime access in tests
jest.mock('next/headers', () => {
  const cookieStore: Record<string, string> = {};
  return {
    headers: () => new Map<string, string>(),
    cookies: () => ({
      get: (k: string) => (k in cookieStore ? { name: k, value: cookieStore[k] } : undefined),
      set: (k: string, v: string) => { cookieStore[k] = v; },
      delete: (k: string) => { delete cookieStore[k]; },
      getAll: () => Object.entries(cookieStore).map(([name, value]) => ({ name, value })),
      has: (k: string) => k in cookieStore,
    }),
  };
});

