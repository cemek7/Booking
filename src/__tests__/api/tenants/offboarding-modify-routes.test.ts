import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ─── Module mocks (must be declared before imports) ───────────────────────────

jest.mock('next/server', () => {
  type HeaderStore = { get(key: string): string | null; set(key: string, value: string): void };
  type HeadersConstructor = new () => HeaderStore;
  const g = globalThis as typeof globalThis & { Headers?: HeadersConstructor };
  const HeadersCtor = g.Headers || class {
    map: Record<string, string> = {};
    get(k: string) { return this.map[k.toLowerCase()] ?? null; }
    set(k: string, v: string) { this.map[k.toLowerCase()] = v; }
  };

  class MockNextResponse {
    ok: boolean;
    status: number;
    headers: HeaderStore;
    private _data: unknown;

    constructor(data: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new HeadersCtor();
      this._data = data;
    }

    async json() { return this._data; }

    static json(data: unknown, init?: { status?: number }) {
      return new MockNextResponse(data, init);
    }
  }

  class MockNextRequest {
    url: string;
    method: string;
    headers: HeaderStore;
    private _body: string | undefined;

    constructor(url: string, init?: RequestInit & { body?: string }) {
      this.url = url;
      this.method = (init?.method ?? 'GET').toUpperCase();
      const h = new HeadersCtor();
      const initHeaders = init?.headers as Record<string, string> | undefined;
      if (initHeaders) {
        for (const [k, v] of Object.entries(initHeaders)) h.set(k, v);
      }
      this.headers = h;
      this._body = init?.body as string | undefined;
    }

    async json() {
      return JSON.parse(this._body ?? 'null');
    }
  }

  return {
    NextResponse: MockNextResponse,
    NextRequest: MockNextRequest,
  };
});

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: jest.fn(() => ({
    sendErrorAlert: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@/lib/logger/api-logger', () => ({
  createApiLogger: jest.fn(() => ({
    logRequest: jest.fn(),
    logError: jest.fn(),
    warn: jest.fn(),
  })),
}));
jest.mock('@/lib/offboarding/offboardService', () => ({
  enterOffboarding: jest.fn().mockResolvedValue({ lifecycleState: 'scheduled_for_deletion' }),
  reactivate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/audit/log', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
// Required by superadmin route
jest.mock('@/lib/billing/ai-wallet', () => ({
  topUpTenantWallet: jest.fn().mockResolvedValue({ allowed: true, balance_credits: 100 }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { enterOffboarding } from '@/lib/offboarding/offboardService';
import { DELETE } from '@/app/api/tenants/[tenantId]/route';
import { PATCH } from '@/app/api/superadmin/tenants/[tenantId]/route';

// ─── Generic chain helper ─────────────────────────────────────────────────────
type MockQueryResult = { data: unknown; error: null };
type MockQueryBuilder = {
  select: () => MockQueryBuilder;
  eq: () => MockQueryBuilder;
  in: () => MockQueryBuilder;
  update: () => MockQueryBuilder;
  upsert: () => Promise<{ error: null }>;
  insert: () => Promise<MockQueryResult>;
  single: () => Promise<MockQueryResult>;
  maybeSingle: () => Promise<MockQueryResult>;
};

function chain(final: MockQueryResult): MockQueryBuilder {
  return {
    select: () => chain(final),
    eq: () => chain(final),
    in: () => chain(final),
    update: () => chain(final),
    upsert: async () => ({ error: null }),
    insert: async () => final,
    single: async () => final,
    maybeSingle: async () => final,
  };
}

// ─── Admin client mock ────────────────────────────────────────────────────────
function adminMock({ isGlobalAdmin = false }: { isGlobalAdmin?: boolean } = {}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'usr_1', email: 'o@test.com' } },
        error: null,
      }),
    },
    from: jest.fn((t: string) => {
      if (t === 'tenants') {
        return chain({
          data: { id: 'ten_1', name: 'Acme', status: 'active', lifecycle_state: 'active' },
          error: null,
        });
      }
      if (t === 'tenant_users') {
        return chain({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null });
      }
      if (t === 'admins') {
        // resolveIsGlobalAdmin: superadmin routes need this to return a row so the
        // role check resolves the effective role to 'superadmin'.
        return chain({ data: isGlobalAdmin ? { email: 'o@test.com', status: 'active' } : null, error: null });
      }
      // offboarding_tasks insert, etc.
      return chain({ data: null, error: null });
    }),
  };
}

// ─── Bearer client mock ───────────────────────────────────────────────────────
// For the DELETE route (owner), membership lookup returns role:'owner'.
// For the superadmin PATCH route (requireTenantMembership: false), tenant_users
// is never queried — only auth.getUser is called.
function bearerMock(role = 'owner') {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'usr_1', email: 'o@test.com' } },
        error: null,
      }),
    },
    from: jest.fn((t: string) => {
      if (t === 'tenant_users') {
        return chain({ data: { tenant_id: 'ten_1', role }, error: null });
      }
      return chain({ data: null, error: null });
    }),
  };
}

// ─── Request factories ────────────────────────────────────────────────────────
function deleteReq() {
  return new NextRequest('http://localhost:3000/api/tenants/ten_1', {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer test-token',
      'x-tenant-id': 'ten_1',
    },
  });
}

function superadminPatchReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/superadmin/tenants/ten_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      // superadmin route uses requireTenantMembership: false — no x-tenant-id needed
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('offboarding modify routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock('owner'));
  });

  // ── DELETE enters off-boarding ───────────────────────────────────────────────
  describe('DELETE /api/tenants/[tenantId]', () => {
    it('returns 200 and schedules off-boarding instead of hard-deleting', async () => {
      const res = await DELETE(
        deleteReq() as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as unknown as Parameters<typeof DELETE>[1],
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ success: true, scheduled: 'ten_1' });
      expect(enterOffboarding).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: 'ten_1', reason: 'voluntary' }),
      );
    });
  });

  // ── Superadmin PATCH with offboard body ──────────────────────────────────────
  describe('PATCH /api/superadmin/tenants/[tenantId]', () => {
    beforeEach(() => {
      // Superadmin route (requireTenantMembership: false, roles: ['superadmin']):
      // the effective role comes from resolveIsGlobalAdmin, so the admins lookup
      // must return a row.
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock({ isGlobalAdmin: true }));
    });

    it('triggers off-boarding when offboard.reason is provided', async () => {
      const res = await PATCH(
        superadminPatchReq({ offboard: { reason: 'gdpr_erasure' } }) as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as unknown as Parameters<typeof PATCH>[1],
      );
      expect(res.status).toBe(200);
      expect(enterOffboarding).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: 'gdpr_erasure', actorRole: 'superadmin' }),
      );
    });

    it('does NOT call enterOffboarding when no offboard key in body', async () => {
      const res = await PATCH(
        superadminPatchReq({ status: 'suspended' }) as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as unknown as Parameters<typeof PATCH>[1],
      );
      expect(res.status).toBe(200);
      expect(enterOffboarding).not.toHaveBeenCalled();
    });

    it('persists a superadmin velocity override on the wallet row', async () => {
      const admin = adminMock({ isGlobalAdmin: true });
      (createSupabaseAdminClient as jest.Mock).mockReturnValue(admin);

      const res = await PATCH(
        superadminPatchReq({ velocity_credits_override: 450 }) as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as unknown as Parameters<typeof PATCH>[1],
      );

      expect(res.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('ai_wallets');
    });
  });
});
