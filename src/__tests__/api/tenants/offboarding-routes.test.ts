import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ─── Module mocks (must be declared before imports) ───────────────────────────

// Extend the global next/server mock to include NextRequest so that
// new NextRequest(...) works in jsdom (jest.setup.ts only mocks NextResponse).
jest.mock('next/server', () => {
  const g = globalThis as any;
  const HeadersCtor = g.Headers || class {
    map: Record<string, string> = {};
    get(k: string) { return this.map[k.toLowerCase()] ?? null; }
    set(k: string, v: string) { this.map[k.toLowerCase()] = v; }
  };

  // NextResponse must be a real class so `instanceof NextResponse` in route-handler
  // doesn't throw "Right-hand side of 'instanceof' is not callable".
  class MockNextResponse {
    ok: boolean;
    status: number;
    headers: any;
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
    headers: any;
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

// Silence audit log writes inside offboardService (called in some paths)
jest.mock('@/lib/audit/log', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { enterOffboarding, reactivate } from '@/lib/offboarding/offboardService';
import { POST as offboardPOST } from '@/app/api/tenants/[tenantId]/offboard/route';
import { POST as reactivatePOST } from '@/app/api/tenants/[tenantId]/reactivate/route';
import { GET as exportGET } from '@/app/api/tenants/[tenantId]/export/route';

// ─── Generic chain helper ─────────────────────────────────────────────────────
function chain(final: any): any {
  return {
    select: () => chain(final),
    eq: () => chain(final),
    in: () => chain(final),
    single: async () => final,
    maybeSingle: async () => final,
    update: () => chain(final),
    insert: async () => final,
  };
}

// ─── Admin client mock ────────────────────────────────────────────────────────
// Called for:
//   1. Lifecycle gate: from('tenants').select('lifecycle_state').eq().maybeSingle()
//   2. Handler body:
//      - offboard: from('tenants').select('id, name').eq().single()
//      - reactivate: (delegated to mocked offboardService — no direct admin calls)
//      - export:    from('offboarding_tasks').select('payload').eq().eq().maybeSingle()
function adminMock() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'usr_1', email: 'o@test.com' } },
        error: null,
      }),
    },
    from: jest.fn((t: string) => {
      if (t === 'tenant_users') {
        // The route-handler validates the header tenant scope against tenant_users
        // (admin-side) before the handler body runs. Owner satisfies these routes.
        return chain({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null });
      }
      if (t === 'tenants') {
        // Covers both the lifecycle gate check AND the offboard route's tenant lookup.
        // lifecycle_state:'active' lets the gate pass; id/name satisfy the business logic.
        return chain({ data: { id: 'ten_1', name: 'Acme', lifecycle_state: 'active' }, error: null });
      }
      if (t === 'offboarding_tasks') {
        return chain({ data: { payload: { export_url: 'https://x/export.zip' } }, error: null });
      }
      // offboarding_tasks insert, tenant_users, admins, etc.
      return chain({ data: null, error: null });
    }),
  };
}

// ─── Bearer client mock ───────────────────────────────────────────────────────
// Used by the route-handler wrapper for:
//   1. auth.getUser(token)
//   2. from('tenant_users').select().eq().eq().maybeSingle() → membership + role
function bearerMock() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'usr_1', email: 'o@test.com' } },
        error: null,
      }),
    },
    from: jest.fn((t: string) => {
      if (t === 'tenant_users') {
        return chain({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null });
      }
      return chain({ data: null, error: null });
    }),
  };
}

// ─── Request factories ────────────────────────────────────────────────────────
function offboardReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/tenants/ten_1/offboard', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      'x-tenant-id': 'ten_1',
    },
    body: JSON.stringify(body),
  });
}

function reactivateReq() {
  return new NextRequest('http://localhost:3000/api/tenants/ten_1/reactivate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      'x-tenant-id': 'ten_1',
    },
    body: JSON.stringify({}),
  });
}

function exportReq() {
  return new NextRequest('http://localhost:3000/api/tenants/ten_1/export', {
    method: 'GET',
    headers: {
      authorization: 'Bearer test-token',
      'x-tenant-id': 'ten_1',
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('offboarding API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock());
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock());
  });

  // ── Offboard POST ────────────────────────────────────────────────────────────
  describe('POST /api/tenants/[tenantId]/offboard', () => {
    it('returns 400 when confirmText does not match the tenant name', async () => {
      const res = await offboardPOST(
        offboardReq({ confirmText: 'Wrong' }) as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as any,
      );
      expect(res.status).toBe(400);
      expect(enterOffboarding).not.toHaveBeenCalled();
    });

    it('returns 200 and lifecycleState when confirmText matches tenant name', async () => {
      const res = await offboardPOST(
        offboardReq({ confirmText: 'Acme' }) as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as any,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ success: true, lifecycleState: 'scheduled_for_deletion' });
      expect(enterOffboarding).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: 'ten_1', reason: 'voluntary' }),
      );
    });
  });

  // ── Reactivate POST ──────────────────────────────────────────────────────────
  describe('POST /api/tenants/[tenantId]/reactivate', () => {
    it('returns 200 success when owner reactivates the tenant', async () => {
      const res = await reactivatePOST(
        reactivateReq() as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as any,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true });
      expect(reactivate).toHaveBeenCalledTimes(1);
    });
  });

  // ── Export GET ───────────────────────────────────────────────────────────────
  describe('GET /api/tenants/[tenantId]/export', () => {
    it('returns 200 with the signed export URL', async () => {
      const res = await exportGET(
        exportReq() as unknown as NextRequest,
        { params: { tenantId: 'ten_1' } } as any,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ url: 'https://x/export.zip' });
    });
  });
});
