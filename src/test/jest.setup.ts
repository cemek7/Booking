// @ts-nocheck
// Optional: @testing-library/jest-dom (install if using React Testing Library)
// import '@testing-library/jest-dom';

// Polyfill fetch and Web APIs for Node.js environment
import fetch, { Request, Response, Headers } from 'node-fetch';

// Bridge global Request/Response/Headers for both browser and Node environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis as any;

// Provide fetch and Web APIs globally
if (!g.fetch) {
  g.fetch = fetch;
  g.Request = Request;
  g.Response = Response;
  g.Headers = Headers;
}

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
jest.mock('@/lib/supabase/server', () => {
  const table = () => ({
    select: async () => ({ data: [], error: null }),
    insert: async (rows?: unknown[]) => ({ data: rows ?? [], error: null }),
    update: async () => ({ data: [], error: null }),
    delete: async () => ({ data: [], error: null }),
    eq: () => table(),
    gt: () => table(),
    gte: () => table(),
    lt: () => table(),
    lte: () => table(),
    order: () => table(),
    limit: () => table(),
    maybeSingle: async () => ({ data: null, error: null })
  });
  const client = { from: () => table() };
  return {
    getBrowserSupabase: () => client,
    createServerSupabaseClient: () => client
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
  return {
    NextResponse: {
      json: (data: unknown, init?: { status?: number }) => makeResponse(data, init),
    },
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

