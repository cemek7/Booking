// Jest globals are available without import
import { POST as invitesPOST } from '@/app/api/tenants/[tenantId]/invites/route';

// Mock Request for Node.js environment
const MockRequest = class {
  method: string;
  url: string;
  headers: Record<string, string>;
  private _body: string;
  
  constructor(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this.headers = options.headers || {};
    this._body = options.body || '';
  }
  
  async json() {
    return JSON.parse(this._body);
  }
};

// Replace global Request for tests
(globalThis as any).Request = MockRequest;

// Configurable stubs
interface TenantInviteSettings { allowedInviterRoles: string[]; allowInvitesFromStaffPage: boolean; }
let currentSettings: TenantInviteSettings = { allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true };
let callerRole = 'manager';
type InviteRow = { tenant_id: string; email: string; role: string };
const inserted: InviteRow[] = [];

function makeSupabase() {
  return {
    from(table: string) {
      if (table === 'tenant_users') {
        return {
          select() { return this; },
          eq(col: string, val: string) { (this as Record<string, unknown>)[col] = val; return this; },
          single() { return Promise.resolve({ data: { role: callerRole }, error: null }); }
        } as {
          select: () => unknown;
          eq: (col: string, val: string) => unknown;
          single: () => Promise<{ data: { role: string }; error: null }>;
        };
      }
      if (table === 'tenants') {
        return {
          select() { return this; },
          eq() { return this; },
          single() { return Promise.resolve({ data: { settings: currentSettings }, error: null }); }
        } as {
          select: () => unknown;
          eq: () => unknown;
          single: () => Promise<{ data: { settings: TenantInviteSettings }; error: null }>;
        };
      }
      if (table === 'invites') {
        return {
          insert(row: InviteRow) { inserted.push(row); return Promise.resolve({ error: null }); }
        } as { insert: (row: InviteRow) => Promise<{ error: null }> };
      }
      return { select() { return this; } } as { select: () => unknown };
    }
  } as unknown;
}

// Mock Supabase Auth anon client
const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: (...args: unknown[]) => mockGetUser(...args) } }) }));

// Mock server supabase
jest.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => makeSupabase(), getBrowserSupabase: () => ({}) }));

describe('Invites API', () => {
  beforeEach(() => {
    currentSettings = { allowedInviterRoles: ['manager'], allowInvitesFromStaffPage: true };
    callerRole = 'manager';
    inserted.length = 0;
    mockGetUser.mockReset();
  });

  it('requires Authorization bearer token', async () => {
    const req = new Request('http://x/api/tenants/t1/invites', { method: 'POST', body: JSON.stringify({ email: 'a@b.com' }) });
    // @ts-expect-error invoking route handler with simplified context for test
    const res = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(401);
  });

  it('creates invite when allowed', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const req = new Request('http://x/api/tenants/t1/invites', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ email: 'user@example.com', role: 'staff' })
    });
    // @ts-expect-error invoking route handler with simplified context for test
    const res = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(200);
    const json = await (res as Response).json();
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('url');
    expect(inserted[0]).toMatchObject({ tenant_id: 't1', email: 'user@example.com', role: 'staff' });
  });

  it('returns 403 when settings disallow', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    currentSettings = { allowedInviterRoles: ['owner'], allowInvitesFromStaffPage: false };
    const req = new Request('http://x/api/tenants/t1/invites', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ email: 'user@example.com', role: 'staff' })
    });
    // @ts-expect-error invoking route handler with simplified context for test
    const res = await invitesPOST(req, { params: { tenantId: 't1' } });
    expect(res.status).toBe(403);
    const json = await (res as Response).json();
    expect(json).toHaveProperty('error', 'invites_not_allowed');
  });
});
