import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createHmac } from 'crypto';

// ── Mocks ───────────────────────────────────────────────────────────────────
const mockFindTenant = jest.fn();
jest.mock('@/lib/instagram/secrets', () => ({
  findTenantByInstagramId: (...args: unknown[]) => mockFindTenant(...args),
}));

const mockEnsureConversation = jest.fn();
const mockAppendPending = jest.fn();
const mockResolveIncoming = jest.fn();
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  ensureConversation: (...a: unknown[]) => mockEnsureConversation(...a),
}));
jest.mock('@/lib/whatsapp/v2/messageBatcher', () => ({
  appendPendingMessage: (...a: unknown[]) => mockAppendPending(...a),
}));
jest.mock('@/lib/whatsapp/v2/identityResolver', () => ({
  resolveIncoming: (...a: unknown[]) => mockResolveIncoming(...a),
}));

let queueInserts: Array<Record<string, unknown>> = [];
const mockCreateAdmin = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockCreateAdmin(),
}));

import { GET, POST } from '@/app/api/webhooks/instagram/route';

const APP_SECRET = 'ig-app-secret';
const VERIFY_TOKEN = 'verify-token';

function buildAdmin() {
  const responders: Record<string, { data: unknown; error: unknown }> = {
    messages: { data: { id: 'msg-1' }, error: null },
    chats: { data: { id: 'chat-1' }, error: null },
    tenants: { data: { v2_enabled: true }, error: null },
    webhook_events: { data: null, error: null },
    whatsapp_message_queue: { data: null, error: null },
  };
  let table = '';
  const builder: Record<string, unknown> = {
    from(t: string) { table = t; return builder; },
    insert(payload: Record<string, unknown>) {
      if (table === 'whatsapp_message_queue') queueInserts.push(payload);
      return builder;
    },
    upsert() { return builder; },
    select() { return builder; },
    eq() { return builder; },
    single() { return Promise.resolve(responders[table]); },
    maybeSingle() { return Promise.resolve(responders[table]); },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(responders[table]).then(res, rej);
    },
  };
  return builder;
}

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

function postReq(body: string, signature: string | null) {
  return {
    text: async () => body,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-hub-signature-256' ? signature : null) },
    url: 'https://app.example/api/webhooks/instagram',
  } as never;
}

function getReq(query: string) {
  return { url: `https://app.example/api/webhooks/instagram?${query}` } as never;
}

beforeEach(() => {
  queueInserts = [];
  jest.clearAllMocks();
  process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
  process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.NODE_ENV = 'production'; // skip the dev worker ping
  mockCreateAdmin.mockImplementation(buildAdmin);
  mockFindTenant.mockResolvedValue('tenant-1');
  mockResolveIncoming.mockResolvedValue({
    tenantId: null,
    role: 'customer',
    routingCodeFound: false,
    strippedMessage: 'hello',
  });
});

describe('GET /api/webhooks/instagram (verification)', () => {
  it('accepts the handshake when the verify token matches', async () => {
    const res = await GET(getReq('hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=98765'));
    expect(res.status).toBe(200);
  });

  it('rejects a wrong verify token', async () => {
    const res = await GET(getReq('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/webhooks/instagram', () => {
  function igPayload(overrides?: Partial<{ is_echo: boolean; text: string }>) {
    return JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'IG_ACCT',
          messaging: [
            {
              sender: { id: 'CUSTOMER_IGSID' },
              recipient: { id: 'IG_ACCT' },
              timestamp: 1700000000000,
              message: { mid: 'mid-1', text: overrides?.text ?? 'hello', is_echo: overrides?.is_echo },
            },
          ],
        },
      ],
    });
  }

  it('rejects an invalid signature with 401', async () => {
    const body = igPayload();
    const res = await POST(postReq(body, 'sha256=deadbeef'));
    expect(res.status).toBe(401);
    expect(queueInserts).toHaveLength(0);
  });

  it('ignores non-instagram payloads (200, no enqueue)', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await POST(postReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ignored_non_instagram_payload' });
    expect(queueInserts).toHaveLength(0);
  });

  it('routes an inbound DM into the v2 queue with channel=instagram', async () => {
    const body = igPayload();
    const res = await POST(postReq(body, sign(body)));
    expect(res.status).toBe(200);

    expect(mockFindTenant).toHaveBeenCalledWith(expect.anything(), 'IG_ACCT');
    // ensureConversation + appendPendingMessage threaded with the instagram channel
    expect(mockEnsureConversation).toHaveBeenCalledWith('CUSTOMER_IGSID', 'tenant-1', 'customer', 'instagram');
    expect(mockAppendPending).toHaveBeenCalledWith('CUSTOMER_IGSID', 'tenant-1', 'hello', 'msg-1', 'instagram');

    expect(queueInserts).toHaveLength(1);
    expect(queueInserts[0]).toMatchObject({
      tenant_id: 'tenant-1',
      from_number: 'CUSTOMER_IGSID',
      to_number: 'IG_ACCT',
      channel: 'instagram',
      status: 'pending',
    });
  });

  it('skips echo messages (our own sends)', async () => {
    const body = igPayload({ is_echo: true });
    const res = await POST(postReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect(queueInserts).toHaveLength(0);
    expect(mockEnsureConversation).not.toHaveBeenCalled();
  });

  it('drops the message when no tenant owns the IG account', async () => {
    mockFindTenant.mockResolvedValue(null);
    const body = igPayload();
    const res = await POST(postReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect(queueInserts).toHaveLength(0);
  });
});
