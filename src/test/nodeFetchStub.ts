// Stub for node-fetch: re-export native Node.js/jsdom globals so the jest setup
// polyfill in jest.setup.ts works without needing the actual node-fetch package.
// Node v18+ and jsdom both provide fetch/Request/Response/Headers natively.

const _fetch = typeof globalThis.fetch !== 'undefined'
  ? globalThis.fetch
  : () => Promise.reject(new Error('fetch not available'));

export default _fetch;

// Provide minimal class stubs if native globals aren't available (jsdom may not set all of them).
class HeadersStub {
  private _map: Record<string, string> = {};
  get(k: string) { return this._map[k.toLowerCase()] ?? null; }
  set(k: string, v: string) { this._map[k.toLowerCase()] = v; }
  has(k: string) { return k.toLowerCase() in this._map; }
  constructor(init?: Record<string, string> | HeadersStub) {
    if (init instanceof HeadersStub) {
      this._map = { ...init._map };
    } else if (init) {
      for (const [k, v] of Object.entries(init)) this.set(k, v);
    }
  }
}

class RequestStub {
  url: string;
  method: string;
  headers: HeadersStub;
  constructor(input: string, init?: { method?: string; headers?: Record<string, string> }) {
    this.url = input;
    this.method = init?.method ?? 'GET';
    this.headers = new HeadersStub(init?.headers);
  }
}

class ResponseStub {
  status: number;
  ok: boolean;
  constructor(_body?: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  async json() { return null; }
  async text() { return ''; }
}

export const Headers = (typeof globalThis.Headers !== 'undefined' ? globalThis.Headers : HeadersStub) as typeof HeadersStub;
export const Request = (typeof globalThis.Request !== 'undefined' ? globalThis.Request : RequestStub) as typeof RequestStub;
export const Response = (typeof globalThis.Response !== 'undefined' ? globalThis.Response : ResponseStub) as typeof ResponseStub;
