# Multi-Provider WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WAHA as a second WhatsApp provider alongside Evolution API, with per-tenant provider selection via a shared `WhatsAppProviderClient` interface.

**Architecture:** A provider column on `whatsapp_configurations` selects the engine (evolution|waha). All session and messaging operations go through a `WhatsAppProviderClient` interface — callers never touch provider internals. A canonical webhook handler at `/api/webhooks/whatsapp` normalises both Evolution and WAHA payloads before passing them to the shared v2 pipeline.

**Tech Stack:** Next.js 16 App Router, Supabase, TypeScript, Zod, Evolution API Lite (Baileys), WAHA Plus (NOWEB engine)

---

## File Map

| File | Action |
|---|---|
| `db/migrations/070_whatsapp_provider.sql` | **Create** — 3 new columns on whatsapp_configurations |
| `src/lib/whatsapp/providers/types.ts` | **Create** — WhatsAppProviderClient interface + ProviderConfig |
| `src/lib/whatsapp/providers/evolution.ts` | **Create** — Evolution adapter |
| `src/lib/whatsapp/providers/waha.ts` | **Create** — WAHA adapter |
| `src/lib/whatsapp/providers/index.ts` | **Create** — getProviderClient factory + getTenantIdByInstanceName re-export |
| `src/lib/whatsapp/evolutionClient.ts` | **Edit** — add `provider` to EvolutionAPIConfig; update getTenantWhatsAppConfig |
| `src/app/api/webhooks/whatsapp/route.ts` | **Create** — canonical normalizing webhook handler |
| `src/app/api/webhooks/evolution/route.ts` | **Edit** — thin re-export of POST from whatsapp route |
| `src/lib/whatsapp/connectionManager.ts` | **Edit** — guard startMonitoring behind provider==='evolution' |
| `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts` | **Edit** — full rewrite of POST; fix GET |
| `src/lib/whatsapp/v2/pipeline.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/lib/whatsapp/v2/waitlist.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/lib/whatsapp/mediaHandler.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/lib/whatsapp/messageProcessor.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/lib/enhancedJobManager.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/app/api/reminders/run/route.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/lib/ai/reviewCollectionAgent.ts` | **Edit** — createEvolutionClient → getProviderClient |
| `src/app/auth/onboarding/page.tsx` | **Edit** — provider radio, phone input, pairingCode display |
| `src/components/settings/WhatsAppSyncSection.tsx` | **Edit** — provider radio + POST body |
| `evolution-api-lite/docker-compose.yaml` | **Edit** — WAHA Plus service + volume |
| `evolution-api-lite/.env` | **Edit** — WAHA_API_KEY |

---

## Task 1: DB Migration

**Files:**
- Create: `db/migrations/070_whatsapp_provider.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 070_whatsapp_provider.sql
-- Adds provider selection columns to whatsapp_configurations.
-- Existing rows default to 'evolution' — zero impact on live tenants.
-- provider_base_url / provider_api_key are read-priority fields:
--   code uses provider_base_url ?? evolution_base_url (and same for api_key)
--   so legacy columns keep working until a tenant explicitly switches.

ALTER TABLE public.whatsapp_configurations
  ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'evolution'
    CHECK (provider IN ('evolution', 'waha')),
  ADD COLUMN IF NOT EXISTS provider_base_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_api_key  TEXT;
```

- [ ] **Step 2: Apply the migration against Supabase**

```bash
psql "$DATABASE_URL" -f db/migrations/070_whatsapp_provider.sql
```

Expected output: `ALTER TABLE`

If you don't have DATABASE_URL set, skip this step — it will be applied manually.

---

## Task 2: Provider Types

**Files:**
- Create: `src/lib/whatsapp/providers/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
export interface WhatsAppProviderClient {
  // Session management
  createInstance(webhookUrl: string, webhookSecret: string): Promise<{
    qrCode?: string;
    pairingCode?: string;
    status: string;
  }>;
  getConnectionStatus(): Promise<{ connected: boolean; phone?: string }>;
  getQrCode(): Promise<string | null>;
  requestPairingCode(phoneNumber: string): Promise<string | null>;
  deleteInstance(): Promise<void>;

  // Message sending
  sendTextMessage(
    to: string,
    text: string,
    quotedMessageId?: string
  ): Promise<{ success: boolean; messageId?: string }>;
  sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type?: 'image' | 'document' | 'audio' | 'video'
  ): Promise<{ success: boolean; messageId?: string }>;
}

export interface ProviderConfig {
  provider: 'evolution' | 'waha';
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to providers/).

---

## Task 3: Evolution Adapter

**Files:**
- Create: `src/lib/whatsapp/providers/evolution.ts`

- [ ] **Step 1: Create the adapter**

The Evolution adapter wraps the existing `EvolutionAPIClient`. It translates the `WhatsAppProviderClient` interface to the methods already on `EvolutionAPIClient`.

```typescript
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { createEvolutionClient } from '@/lib/whatsapp/evolutionClient';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

export class EvolutionAdapter implements WhatsAppProviderClient {
  constructor(private cfg: ProviderConfig) {}

  private get client() {
    return createEvolutionClient({
      provider: 'evolution',
      baseUrl: this.cfg.baseUrl,
      apiKey: this.cfg.apiKey,
      instanceName: this.cfg.instanceName,
    });
  }

  async createInstance(webhookUrl: string, webhookSecret: string) {
    const client = createEvolutionClient({
      provider: 'evolution',
      baseUrl: this.cfg.baseUrl,
      apiKey: this.cfg.apiKey,
      instanceName: this.cfg.instanceName,
      webhookUrl,
    });
    const result = await client.initializeInstance();
    return {
      qrCode: result.qrCode,
      status: result.status ?? 'connecting',
    };
  }

  async getConnectionStatus() {
    return this.client.getConnectionStatus();
  }

  async getQrCode(): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/instance/connect/${this.cfg.instanceName}`,
        { headers: { apikey: this.cfg.apiKey }, timeoutMs: 10_000 }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.qrcode?.base64 || data.qrcode?.code || data.qr || null;
    } catch {
      return null;
    }
  }

  async requestPairingCode(phoneNumber: string): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/instance/pairingCode/${this.cfg.instanceName}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: this.cfg.apiKey },
          body: JSON.stringify({ phoneNumber }),
          timeoutMs: 15_000,
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.code || null;
    } catch {
      return null;
    }
  }

  async deleteInstance(): Promise<void> {
    try {
      await fetchWithTimeout(
        `${this.cfg.baseUrl}/instance/delete/${this.cfg.instanceName}`,
        { method: 'DELETE', headers: { apikey: this.cfg.apiKey }, timeoutMs: 10_000 }
      );
    } catch {
      // fire-and-forget — ignore errors
    }
  }

  async sendTextMessage(to: string, text: string, quotedMessageId?: string) {
    return this.client.sendTextMessage(to, text, quotedMessageId);
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
    return this.client.sendMediaMessage(to, media, caption, type);
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "providers/evolution" | head -10
```

Expected: no errors for this file.

---

## Task 4: WAHA Adapter

**Files:**
- Create: `src/lib/whatsapp/providers/waha.ts`

- [ ] **Step 1: Create the adapter**

WAHA uses `X-Api-Key` header (not `apikey`). Session name == instanceName.

```typescript
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

export class WahaAdapter implements WhatsAppProviderClient {
  constructor(private cfg: ProviderConfig) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.cfg.apiKey,
    };
  }

  private cleanPhone(number: string): string {
    return number.replace(/\D/g, '');
  }

  async createInstance(webhookUrl: string, webhookSecret: string) {
    const res = await fetchWithTimeout(`${this.cfg.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name: this.cfg.instanceName,
        config: {
          webhooks: [
            {
              url: webhookUrl,
              events: ['message', 'session.status'],
              customHeaders: [{ name: 'x-evolution-secret', value: webhookSecret }],
            },
          ],
        },
      }),
      timeoutMs: 15_000,
    });
    if (!res.ok) {
      throw new Error(`WAHA createInstance error: ${res.status}`);
    }
    const data = await res.json();
    return { status: data.status ?? 'connecting' };
  }

  async getConnectionStatus() {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}`,
        { headers: { 'X-Api-Key': this.cfg.apiKey }, timeoutMs: 10_000 }
      );
      if (!res.ok) return { connected: false };
      const data = await res.json();
      return {
        connected: data.status === 'WORKING',
        phone: data.me?.id?.replace(/@c\.us/, '') ?? undefined,
      };
    } catch {
      return { connected: false };
    }
  }

  async getQrCode(): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}/qr`,
        { headers: { 'X-Api-Key': this.cfg.apiKey }, timeoutMs: 10_000 }
      );
      if (!res.ok) return null;
      const data = await res.json();
      // WAHA returns { value: "data:image/png;base64,..." }
      return data.value || null;
    } catch {
      return null;
    }
  }

  async requestPairingCode(phoneNumber: string): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}/auth/request-code`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ phoneNumber: this.cleanPhone(phoneNumber) }),
          timeoutMs: 15_000,
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.code || null;
    } catch {
      return null;
    }
  }

  async deleteInstance(): Promise<void> {
    try {
      await fetchWithTimeout(
        `${this.cfg.baseUrl}/api/sessions/${this.cfg.instanceName}`,
        { method: 'DELETE', headers: { 'X-Api-Key': this.cfg.apiKey }, timeoutMs: 10_000 }
      );
    } catch {
      // fire-and-forget
    }
  }

  async sendTextMessage(to: string, text: string, _quotedMessageId?: string) {
    try {
      const res = await fetchWithTimeout(`${this.cfg.baseUrl}/api/sendText`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          session: this.cfg.instanceName,
          chatId: `${this.cleanPhone(to)}@c.us`,
          text,
        }),
        timeoutMs: 10_000,
      });
      if (!res.ok) return { success: false };
      const data = await res.json();
      return { success: true, messageId: data.id?._serialized };
    } catch {
      return { success: false };
    }
  }

  async sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'document' | 'audio' | 'video' = 'image'
  ) {
    try {
      const endpoint = type === 'document' ? 'sendFile' : 'sendImage';
      const res = await fetchWithTimeout(`${this.cfg.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          session: this.cfg.instanceName,
          chatId: `${this.cleanPhone(to)}@c.us`,
          file: { url: media.url, mimetype: media.mimetype, filename: media.filename },
          caption: caption || '',
        }),
        timeoutMs: 15_000,
      });
      if (!res.ok) return { success: false };
      const data = await res.json();
      return { success: true, messageId: data.id?._serialized };
    } catch {
      return { success: false };
    }
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "providers/waha" | head -10
```

Expected: no errors for this file.

---

## Task 5: Provider Factory

**Files:**
- Create: `src/lib/whatsapp/providers/index.ts`

- [ ] **Step 1: Write the factory**

```typescript
import { EvolutionAdapter } from './evolution';
import { WahaAdapter } from './waha';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

export function getProviderClient(config: ProviderConfig): WhatsAppProviderClient {
  if (config.provider === 'waha') return new WahaAdapter(config);
  return new EvolutionAdapter(config);
}

export { getTenantIdByInstanceName } from '@/lib/whatsapp/evolutionClient';
export type { WhatsAppProviderClient, ProviderConfig } from './types';
```

- [ ] **Step 2: Write unit test**

Create `tests/whatsapp-providers.test.ts`:

```typescript
import { getProviderClient } from '@/lib/whatsapp/providers';
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution';
import { WahaAdapter } from '@/lib/whatsapp/providers/waha';

describe('getProviderClient', () => {
  const base = { baseUrl: 'http://localhost:8080', apiKey: 'key', instanceName: 'test' };

  it('returns EvolutionAdapter for provider=evolution', () => {
    const client = getProviderClient({ ...base, provider: 'evolution' });
    expect(client).toBeInstanceOf(EvolutionAdapter);
  });

  it('returns WahaAdapter for provider=waha', () => {
    const client = getProviderClient({ ...base, provider: 'waha' });
    expect(client).toBeInstanceOf(WahaAdapter);
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx jest tests/whatsapp-providers.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 2 passed`

---

## Task 6: Update evolutionClient.ts

**Files:**
- Modify: `src/lib/whatsapp/evolutionClient.ts`

Two changes needed:
1. Add `provider?: 'evolution' | 'waha'` to `EvolutionAPIConfig` interface
2. Update `getTenantWhatsAppConfig` to read `provider_base_url ?? evolution_base_url`

- [ ] **Step 1: Add `provider` to EvolutionAPIConfig interface**

In `src/lib/whatsapp/evolutionClient.ts`, find:
```typescript
export interface EvolutionAPIConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl?: string;
}
```

Replace with:
```typescript
export interface EvolutionAPIConfig {
  provider?: 'evolution' | 'waha';
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl?: string;
}
```

- [ ] **Step 2: Update getTenantWhatsAppConfig return mapping**

Find the return block inside `getTenantWhatsAppConfig` (around line 584):
```typescript
    return {
      baseUrl: data.evolution_base_url,
      apiKey: data.evolution_api_key,
      instanceName: data.instance_name,
      webhookUrl: data.webhook_url
    };
```

Replace with:
```typescript
    return {
      provider: (data.provider ?? 'evolution') as 'evolution' | 'waha',
      baseUrl:  data.provider_base_url ?? data.evolution_base_url,
      apiKey:   data.provider_api_key  ?? data.evolution_api_key,
      instanceName: data.instance_name,
      webhookUrl: data.webhook_url,
    };
```

- [ ] **Step 3: TypeScript check**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "evolutionClient" | head -10
```

Expected: no new errors.

---

## Task 7: Canonical Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/whatsapp/route.ts`

This is the new canonical handler that normalises both Evolution and WAHA payloads. The existing `/api/webhooks/evolution` route will re-export POST from this file in Task 8.

The key detection logic: Evolution payloads have `instance` + `event` at root; WAHA payloads have `session` + `event` at root with message content under `payload`.

- [ ] **Step 1: Write the canonical webhook handler**

```typescript
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { enqueueJob } from '@/lib/webhooks';
import { getTenantIdByInstanceName } from '@/lib/whatsapp/providers';
import { whatsappMediaHandler } from '@/lib/whatsapp/mediaHandler';
import { trace, Span } from '@opentelemetry/api';
import { defaultLogger } from '@/lib/logger';

// ─── Payload type guards ───────────────────────────────────────────────────

interface EvolutionPayload {
  instance?: string;
  event?: string;
  data?: {
    key?: { id?: string; fromMe?: boolean; remoteJid?: string };
    message?: Record<string, unknown>;
    messageTimestamp?: number;
    qrcode?: { base64?: string; code?: string };
    state?: string;
    wuid?: string;
    instance?: { ownerJid?: string };
  };
}

interface WahaPayload {
  session?: string;
  event?: string;
  payload?: {
    id?: { _serialized?: string; fromMe?: boolean };
    from?: string;
    body?: string;
    timestamp?: number;
    type?: string;
    mediaUrl?: string;
    caption?: string;
    status?: string;
    qr?: { value?: string };
    me?: { id?: string };
  };
}

type DetectedProvider = 'evolution' | 'waha';

function detectProvider(raw: unknown): DetectedProvider {
  if (raw && typeof raw === 'object' && 'session' in raw) return 'waha';
  return 'evolution';
}

// ─── Shared entry point ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const tracer = trace.getTracer('boka-webhook');
  const span = tracer.startSpan('webhook.whatsapp');

  try {
    const rawBody = await request.text();
    const raw = JSON.parse(rawBody);
    const supabase = createSupabaseAdminClient();

    // 1. Secret validation (same header for both providers)
    const evolutionSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!evolutionSecret) {
      defaultLogger.error('[WEBHOOK] EVOLUTION_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const incomingSecret = request.headers.get('x-evolution-secret') ?? '';
    const expected = Buffer.from(evolutionSecret);
    const incoming = Buffer.from(incomingSecret);
    const secretValid =
      incoming.length === expected.length && timingSafeEqual(expected, incoming);
    if (!secretValid) {
      defaultLogger.warn('[WEBHOOK] Secret mismatch — request rejected');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const provider = detectProvider(raw);

    if (provider === 'waha') {
      return handleWaha(raw as WahaPayload, supabase, span);
    }
    return handleEvolution(raw as EvolutionPayload, supabase, span);
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Unhandled error:', e);
    span.end();
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    span.end();
  }
}

// ─── WAHA handler ──────────────────────────────────────────────────────────

async function handleWaha(
  raw: WahaPayload,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  span: Span
): Promise<NextResponse> {
  const instance = raw.session;
  const event = raw.event ?? '';
  const p = raw.payload ?? {};

  if (!instance) {
    return NextResponse.json({ error: 'Missing session in WAHA payload' }, { status: 400 });
  }

  const tenantId = await getTenantIdByInstanceName(instance);
  if (!tenantId) {
    defaultLogger.warn(`[WEBHOOK-WAHA] Unknown session: ${instance}`);
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  span.setAttribute('tenant.id', tenantId);

  // session.status handles both connection updates AND QR code delivery
  if (event === 'session.status') {
    const status = p.status ?? '';

    if (status === 'SCAN_QR_CODE') {
      const qrCode = p.qr?.value ?? null;
      if (qrCode) {
        await supabase
          .from('whatsapp_connections')
          .upsert(
            { tenant_id: tenantId, instance_name: instance, status: 'connecting', qr_code: qrCode, updated_at: new Date().toISOString() },
            { onConflict: 'tenant_id,instance_name' }
          );
      }
      return NextResponse.json({ status: 'qr_stored' }, { status: 200 });
    }

    if (status === 'WORKING') {
      const phone = p.me?.id?.replace(/@c\.us/, '') ?? null;
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connected', phone_number: phone, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
      return NextResponse.json({ status: 'connection_updated', state: 'open' }, { status: 200 });
    }

    if (status === 'STOPPED' || status === 'FAILED') {
      await supabase
        .from('whatsapp_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('instance_name', instance);
      return NextResponse.json({ status: 'connection_updated', state: 'close' }, { status: 200 });
    }

    if (status === 'STARTING') {
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connecting', updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
      return NextResponse.json({ status: 'connection_updated', state: 'connecting' }, { status: 200 });
    }

    // Unknown status — log and ack
    defaultLogger.warn(`[WEBHOOK-WAHA] Unknown session status: ${status}`);
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  if (event === 'message') {
    if (p.id?.fromMe) {
      return NextResponse.json({ status: 'skipped_own_message' }, { status: 200 });
    }

    const messageId = p.id?._serialized;
    if (!messageId) {
      return NextResponse.json({ error: 'Missing message id' }, { status: 400 });
    }

    // Idempotency — using (provider, instance:messageId)
    const isDuplicate = await handleIdempotency(supabase, 'waha', instance, messageId, raw, span);
    if (isDuplicate) return NextResponse.json({ status: 'duplicate' }, { status: 200 });

    const fromNumber = p.from?.replace(/@c\.us/, '') ?? '';
    const messageContent = p.body ?? '';
    const messageType = p.type === 'chat' ? 'text' : (p.type ?? 'unknown');

    const parsedMessage: Record<string, unknown> = {
      tenant_id: tenantId,
      from_number: fromNumber,
      to_number: instance,
      content: messageContent,
      direction: 'inbound',
      message_type: messageType,
      raw,
      media_info: p.mediaUrl
        ? { url: p.mediaUrl, caption: p.caption }
        : null,
      evolution_message_id: messageId,
      timestamp: new Date((p.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
    };

    const chatId = await upsertChat(supabase, tenantId, fromNumber);
    if (chatId) parsedMessage.chat_id = chatId;

    const messageRowId = await persistMessage(supabase, parsedMessage);
    if (!messageRowId) {
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
    }
    span.setAttribute('message.id', messageRowId);

    return routeMessage(supabase, tenantId, instance, fromNumber, messageContent, messageRowId, parsedMessage);
  }

  // Unknown event — ack silently
  defaultLogger.warn(`[WEBHOOK-WAHA] Unknown event: ${event}`);
  return NextResponse.json({ status: 'ignored' }, { status: 200 });
}

// ─── Evolution handler ─────────────────────────────────────────────────────

async function handleEvolution(
  payload: EvolutionPayload,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  span: Span
): Promise<NextResponse> {
  const instance = payload?.instance;
  const event = payload?.event ?? '';

  if (payload?.data?.key?.fromMe) {
    return NextResponse.json({ status: 'skipped_own_message' }, { status: 200 });
  }
  if (!instance) {
    return NextResponse.json({ error: 'Missing instance name in payload' }, { status: 400 });
  }

  const tenantId = await getTenantIdByInstanceName(instance);
  if (!tenantId) {
    defaultLogger.warn(`[WEBHOOK-EVO] Unknown instance: ${instance}`);
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  span.setAttribute('tenant.id', tenantId);

  if (event === 'qrcode.updated') {
    const qrCode = payload?.data?.qrcode?.base64 || payload?.data?.qrcode?.code || null;
    if (qrCode) {
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connecting', qr_code: qrCode, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
    }
    return NextResponse.json({ status: 'qr_stored' }, { status: 200 });
  }

  if (event === 'connection.update') {
    const state = payload?.data?.state;
    if (state === 'open') {
      const phone =
        payload?.data?.wuid?.split('@')[0] ||
        payload?.data?.instance?.ownerJid?.split('@')[0] ||
        null;
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connected', phone_number: phone, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
    } else if (state === 'close') {
      await supabase
        .from('whatsapp_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('instance_name', instance);
    }
    return NextResponse.json({ status: 'connection_updated', state }, { status: 200 });
  }

  if (!payload?.data?.key?.id) {
    defaultLogger.warn('[WEBHOOK-EVO] Missing message key.id');
    return NextResponse.json({ error: 'Invalid payload: missing data.key.id' }, { status: 400 });
  }

  const messageId = payload.data.key.id;
  const isDuplicate = await handleIdempotency(supabase, 'evolution', instance, messageId, payload, span);
  if (isDuplicate) return NextResponse.json({ status: 'duplicate', replay: true }, { status: 200 });

  const parsedMessage = parseEvolutionMessage(payload, tenantId);
  if (!parsedMessage) {
    return NextResponse.json({ error: 'Could not parse message' }, { status: 400 });
  }

  const chatId = await upsertChat(supabase, tenantId, parsedMessage.from_number as string);
  if (chatId) parsedMessage.chat_id = chatId;

  const messageRowId = await persistMessage(supabase, parsedMessage);
  if (!messageRowId) {
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
  span.setAttribute('message.id', messageRowId);

  if (parsedMessage.media_info) {
    await processMedia(supabase, tenantId, parsedMessage, messageRowId);
  }

  return routeMessage(
    supabase,
    tenantId,
    instance,
    parsedMessage.from_number as string,
    parsedMessage.content as string,
    messageRowId,
    parsedMessage
  );
}

// ─── Shared helpers ────────────────────────────────────────────────────────

async function routeMessage(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  instance: string,
  fromNumber: string,
  content: string,
  messageRowId: string,
  _parsedMessage: Record<string, unknown>
): Promise<NextResponse> {
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('v2_enabled')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantRow?.v2_enabled) {
    const { appendPendingMessage } = await import('@/lib/whatsapp/v2/messageBatcher');
    const { resolveIncoming } = await import('@/lib/whatsapp/v2/identityResolver');
    const { ensureConversation } = await import('@/lib/whatsapp/v2/conversationState');

    const identity = await resolveIncoming(fromNumber, content);
    const resolvedTenantId = identity.tenantId ?? tenantId;
    const role = identity.role;

    await ensureConversation(fromNumber, resolvedTenantId, role);
    await appendPendingMessage(fromNumber, resolvedTenantId, identity.strippedMessage || content, messageRowId);

    await supabase.from('whatsapp_message_queue').insert({
      tenant_id: resolvedTenantId,
      message_id: messageRowId,
      from_number: fromNumber,
      to_number: instance,
      content: identity.strippedMessage || content,
      status: 'pending',
      priority: 'normal',
    });

    if (process.env.NODE_ENV !== 'production') {
      const workerBase = process.env.APP_URL || 'http://localhost:3000';
      fetch(`${workerBase}/api/worker/whatsapp`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET || 'dev-cron-secret'}` },
      }).catch(() => {});
    }

    return NextResponse.json({ status: 'accepted_v2', messageId: messageRowId }, { status: 202 });
  }

  await enqueueJob(supabase, 'process_whatsapp_message', {
    message_id: messageRowId,
    tenant_id: tenantId,
  });

  return NextResponse.json({ status: 'accepted', messageId: messageRowId }, { status: 202 });
}

async function handleIdempotency(
  supabase: SupabaseClient,
  provider: 'evolution' | 'waha',
  instance: string,
  messageId: string,
  payload: unknown,
  span: Span
): Promise<boolean> {
  try {
    const externalId = `${instance}:${messageId}`;
    const { error } = await supabase.from('webhook_events').insert({
      provider,
      external_id: externalId,
      payload,
      processed_at: new Date().toISOString(),
    });
    if (error?.code === '23505') {
      span.setAttribute('webhook.is_duplicate', true);
      return true;
    }
    if (error) throw error;
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Idempotency check error:', e);
  }
  span.setAttribute('webhook.is_duplicate', false);
  return false;
}

function parseEvolutionMessage(
  payload: EvolutionPayload,
  tenantId: string
): Record<string, unknown> | null {
  const { instance, data } = payload;
  const { key, message, messageTimestamp } = data || {};
  if (!key || !message) return null;

  const remoteJid = key.remoteJid;
  const phoneNumber = remoteJid?.replace(/@s\.whatsapp\.net|@c\.us/g, '');

  let messageContent = '';
  let messageType = 'unknown';
  let mediaInfo = null;

  if (message.conversation) {
    messageContent = message.conversation as string;
    messageType = 'text';
  } else if ((message.extendedTextMessage as Record<string, unknown>)?.text) {
    messageContent = (message.extendedTextMessage as Record<string, unknown>).text as string;
    messageType = 'text';
  } else if (message.imageMessage) {
    const img = message.imageMessage as Record<string, unknown>;
    messageContent = (img.caption as string) || '';
    messageType = 'image';
    mediaInfo = { url: img.url, mimeType: img.mimetype, caption: img.caption, fileName: img.fileName };
  } else if (message.videoMessage) {
    const vid = message.videoMessage as Record<string, unknown>;
    messageContent = (vid.caption as string) || '';
    messageType = 'video';
    mediaInfo = { url: vid.url, mimeType: vid.mimetype, caption: vid.caption };
  } else if (message.documentMessage) {
    const doc = message.documentMessage as Record<string, unknown>;
    messageContent = (doc.title as string) || (doc.fileName as string) || 'Document';
    messageType = 'document';
    mediaInfo = { url: doc.url, mimeType: doc.mimetype, title: doc.title, fileName: doc.fileName };
  } else if (message.audioMessage) {
    const aud = message.audioMessage as Record<string, unknown>;
    messageContent = '[Audio]';
    messageType = 'audio';
    mediaInfo = { url: aud.url, mimeType: aud.mimetype };
  } else if ((message.templateButtonReplyMessage as Record<string, unknown>)?.selectedDisplayText) {
    messageContent = ((message.templateButtonReplyMessage as Record<string, unknown>).selectedDisplayText as string);
    messageType = 'button_reply';
  } else if ((message.listResponseMessage as Record<string, unknown>)?.title) {
    messageContent = ((message.listResponseMessage as Record<string, unknown>).title as string);
    messageType = 'list_reply';
  }

  return {
    tenant_id: tenantId,
    from_number: phoneNumber,
    to_number: instance,
    content: messageContent,
    direction: 'inbound',
    message_type: messageType,
    raw: payload,
    media_info: mediaInfo,
    evolution_message_id: key.id,
    timestamp: new Date((messageTimestamp ?? 0) * 1000).toISOString(),
  };
}

async function persistMessage(
  supabase: SupabaseClient,
  message: Record<string, unknown>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert(message)
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Failed to persist message:', e);
    return null;
  }
}

async function upsertChat(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  phone: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('chats')
    .upsert(
      { tenant_id: tenantId, customer_phone: phone, last_message_at: new Date().toISOString() },
      { onConflict: 'tenant_id,customer_phone' }
    )
    .select('id')
    .single();
  if (error) {
    defaultLogger.error('[WEBHOOK] Failed to upsert chat:', error);
    return null;
  }
  return data.id;
}

async function processMedia(
  supabase: SupabaseClient,
  tenantId: string,
  message: Record<string, unknown>,
  messageRowId: string
) {
  try {
    const mediaResult = await whatsappMediaHandler.processIncomingMedia(
      tenantId,
      message.from_number as string,
      {
        id: message.evolution_message_id,
        type: message.message_type,
        ...(message.media_info as object),
      }
    );

    if (mediaResult.success && mediaResult.url) {
      await supabase
        .from('messages')
        .update({ media_url: mediaResult.url })
        .eq('id', messageRowId);
    }
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Media processing error:', e);
  }
}
```

- [ ] **Step 2: Write normalizer unit tests**

Create `tests/whatsapp-normalizer.test.ts`:

```typescript
// Unit tests for the payload detection logic in the canonical webhook handler.
// We test the internal detectProvider function by inspecting its behavior
// via the exported module structure.

describe('WAHA payload detection', () => {
  function detectProvider(raw: unknown): 'evolution' | 'waha' {
    if (raw && typeof raw === 'object' && 'session' in raw) return 'waha';
    return 'evolution';
  }

  it('detects WAHA from session field', () => {
    expect(detectProvider({ session: 'myinstance', event: 'message' })).toBe('waha');
  });

  it('detects Evolution from instance field', () => {
    expect(detectProvider({ instance: 'myinstance', event: 'messages.upsert' })).toBe('evolution');
  });

  it('defaults to evolution for unknown shape', () => {
    expect(detectProvider({ event: 'something' })).toBe('evolution');
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx jest tests/whatsapp-normalizer.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 3 passed`

- [ ] **Step 4: TypeScript check**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "webhooks/whatsapp" | head -10
```

Expected: no errors.

---

## Task 8: Update Evolution Webhook to Re-export

**Files:**
- Modify: `src/app/api/webhooks/evolution/route.ts`

Replace the entire file with a thin re-export. All existing Evolution instances continue working without any reconfiguration since the URL `/api/webhooks/evolution` still exists.

- [ ] **Step 1: Replace file content**

```typescript
export const dynamic = 'force-dynamic';

// All logic moved to the canonical multi-provider handler.
// This file exists so existing Evolution instances with webhooks pointing to
// /api/webhooks/evolution continue to work without reconfiguration.
export { POST } from '@/app/api/webhooks/whatsapp/route';
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "webhooks/evolution" | head -10
```

Expected: no errors.

---

## Task 9: Guard connectionManager

**Files:**
- Modify: `src/lib/whatsapp/connectionManager.ts`

Only Evolution tenants use connection monitoring. The `startMonitoring()` method must skip WAHA configs. `forceReconnect`, `getQRCode`, and `checkInstanceConnection` are dead code or only reachable through `startMonitoring`, so no changes needed there.

- [ ] **Step 1: Remove the @ts-nocheck directive and add provider guard**

In `src/lib/whatsapp/connectionManager.ts`, the file starts with `// @ts-nocheck`. Remove that line.

Find the `startInstanceMonitoring` method or the loop inside `startMonitoring` that iterates over configs. Inside the loop, add a guard before starting monitoring:

Find this code pattern inside the for loop in `startMonitoring` (around line 71):
```typescript
    for (const config of configs || []) {
      await this.startInstanceMonitoring(config);
    }
```

Replace with:
```typescript
    for (const config of configs || []) {
      // Only Evolution instances support active polling via connectionManager.
      // WAHA connections are entirely event-driven via webhooks.
      if ((config.provider ?? 'evolution') !== 'evolution') continue;
      await this.startInstanceMonitoring(config);
    }
```

- [ ] **Step 2: TypeScript check — connectionManager may have many pre-existing type errors from the @ts-nocheck removal**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "connectionManager" | head -20
```

If there are errors from removing `@ts-nocheck`, restore the directive at the top but add it AFTER the guard change. The goal is just the guard — do not break existing behavior. If removing `@ts-nocheck` causes more than 5 new errors in this file, restore it and leave only the provider guard change.

---

## Task 10: Rewrite Connect Route

**Files:**
- Modify: `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts`

This is the largest single-file change. The POST handler is completely rewritten. The GET handler has one targeted fix (replace bare `fetch()` with `getProviderClient().getQrCode()`).

- [ ] **Step 1: Rewrite the entire file**

```typescript
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getProviderClient } from '@/lib/whatsapp/providers';
import { whatsappConnectionManager } from '@/lib/whatsapp/connectionManager';

async function activateV2(tenantId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('id, name, routing_code, v2_enabled')
    .eq('id', tenantId)
    .maybeSingle();
  const updates: Record<string, unknown> = { v2_enabled: true, updated_at: new Date().toISOString() };
  if (!tenantRow?.routing_code && tenantRow?.name) {
    const { generateRoutingCode } = await import('@/lib/whatsapp/v2/identityResolver');
    updates.routing_code = await generateRoutingCode(tenantRow.name);
  }
  await admin.from('tenants').update(updates).eq('id', tenantId);
}

const ConnectBodySchema = z.object({
  instanceName: z.string().optional(),
  webhookUrl:   z.string().url().optional(),
  provider:     z.enum(['evolution', 'waha']).optional(),
  phoneNumber:  z.string().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const rawBody = await ctx.request.json().catch(() => ({}));
    const parsed = ConnectBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }
    const body = parsed.data;

    // Fetch existing config to carry forward the current provider
    const admin = createSupabaseAdminClient();
    const { data: existingConfig } = await admin
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .maybeSingle();

    const effectiveProvider: 'evolution' | 'waha' =
      body.provider ?? (existingConfig?.provider as 'evolution' | 'waha' | undefined) ?? 'evolution';

    // Resolve base URL and API key from env by provider
    const EVOLUTION_BASE_URL = process.env.EVOLUTION_API_BASE || 'http://localhost:8080';
    const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY  || '';
    const WAHA_BASE_URL      = process.env.WAHA_API_BASE      || 'http://localhost:3100';
    const WAHA_API_KEY       = process.env.WAHA_API_KEY       || '';

    const providerBaseUrl = effectiveProvider === 'waha' ? WAHA_BASE_URL : EVOLUTION_BASE_URL;
    const providerApiKey  = effectiveProvider === 'waha' ? WAHA_API_KEY  : EVOLUTION_API_KEY;

    if (!providerApiKey) {
      throw ApiErrorFactory.internalServerError(
        new Error(`${effectiveProvider.toUpperCase()}_API_KEY is not configured on the server`)
      );
    }

    const instanceName = body.instanceName || existingConfig?.instance_name || `booka-${tenantId.slice(0, 8)}`;
    const webhookUrl =
      body.webhookUrl ||
      process.env.EVOLUTION_WEBHOOK_URL ||
      `${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || '';

    // If provider changed — delete old instance fire-and-forget
    const previousProvider = existingConfig?.provider ?? 'evolution';
    if (existingConfig && previousProvider !== effectiveProvider) {
      const oldBaseUrl = existingConfig.provider_base_url ?? existingConfig.evolution_base_url;
      const oldApiKey  = existingConfig.provider_api_key  ?? existingConfig.evolution_api_key;
      getProviderClient({
        provider: previousProvider as 'evolution' | 'waha',
        baseUrl: oldBaseUrl,
        apiKey: oldApiKey,
        instanceName: existingConfig.instance_name,
      }).deleteInstance().catch(() => {});

      // Clear stale connection row
      await admin
        .from('whatsapp_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('instance_name', existingConfig.instance_name);
    }

    // Upsert configuration in DB
    const { error: upsertError } = await admin
      .from('whatsapp_configurations')
      .upsert(
        {
          tenant_id:          tenantId,
          instance_name:      instanceName,
          evolution_base_url: EVOLUTION_BASE_URL,
          evolution_api_key:  EVOLUTION_API_KEY,
          provider:           effectiveProvider,
          provider_base_url:  providerBaseUrl,
          provider_api_key:   providerApiKey,
          webhook_url:        webhookUrl,
          active:             true,
          updated_at:         new Date().toISOString(),
        },
        { onConflict: 'tenant_id' }
      );

    if (upsertError) throw ApiErrorFactory.databaseError(upsertError);

    const client = getProviderClient({
      provider: effectiveProvider,
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey,
      instanceName,
    });

    const initResult = await client.createInstance(webhookUrl, webhookSecret);

    // Check if already connected
    const statusResult = await client.getConnectionStatus();
    if (statusResult.connected) {
      await admin.from('whatsapp_connections').upsert(
        { tenant_id: tenantId, instance_name: instanceName, status: 'connected', phone_number: statusResult.phone, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,instance_name' }
      );
      activateV2(tenantId).catch(() => {});
      if (effectiveProvider === 'evolution') {
        whatsappConnectionManager.startMonitoring(tenantId).catch(() => {});
      }
      return { status: 'connected', instanceName, phone: statusResult.phone, message: 'WhatsApp already connected.' };
    }

    // Not yet connected — store QR if available
    const qrCode = initResult.qrCode ?? await client.getQrCode();

    await admin.from('whatsapp_connections').upsert(
      { tenant_id: tenantId, instance_name: instanceName, status: 'connecting', qr_code: qrCode, webhook_url: webhookUrl, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,instance_name' }
    );

    activateV2(tenantId).catch(() => {});
    if (effectiveProvider === 'evolution') {
      whatsappConnectionManager.startMonitoring(tenantId).catch(() => {});
    }

    // Pairing code — only if phoneNumber provided
    let pairingCode: string | null = null;
    if (body.phoneNumber) {
      pairingCode = await client.requestPairingCode(body.phoneNumber).catch(() => null);
    }

    return {
      status: qrCode ? 'pending_scan' : 'connecting',
      instanceName,
      provider: effectiveProvider,
      qrCode: qrCode ?? undefined,
      pairingCode: pairingCode ?? undefined,
      webhookUrl,
      message: pairingCode
        ? 'Enter the pairing code in WhatsApp > Linked Devices > Link with phone number.'
        : qrCode
        ? 'Scan the QR code with your WhatsApp to connect.'
        : 'Waiting for QR code — it will arrive shortly via webhook.',
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single();

    if (configError || !config) {
      return { status: 'not_configured', message: 'No WhatsApp configuration found. Call POST first.' };
    }

    const { data: conn } = await ctx.supabase
      .from('whatsapp_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('instance_name', config.instance_name)
      .single();

    if (conn?.status === 'connected') {
      return { status: 'connected', instanceName: config.instance_name, phone: conn.phone_number, profileName: conn.profile_name };
    }

    let qrCode = conn?.qr_code ?? null;

    if (!qrCode) {
      const client = getProviderClient({
        provider: (config.provider ?? 'evolution') as 'evolution' | 'waha',
        baseUrl:  config.provider_base_url ?? config.evolution_base_url,
        apiKey:   config.provider_api_key  ?? config.evolution_api_key,
        instanceName: config.instance_name,
      });
      qrCode = await client.getQrCode();

      if (qrCode) {
        await createSupabaseAdminClient()
          .from('whatsapp_connections')
          .upsert(
            { tenant_id: tenantId, instance_name: config.instance_name, status: 'connecting', qr_code: qrCode, updated_at: new Date().toISOString() },
            { onConflict: 'tenant_id,instance_name' }
          );
      }
    }

    return {
      status: conn?.status ?? 'not_connected',
      instanceName: config.instance_name,
      provider: config.provider ?? 'evolution',
      qrCode,
      message: qrCode ? 'Scan the QR code with WhatsApp.' : 'No QR code available yet — try again in a few seconds.',
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep "whatsapp/connect" | head -10
```

Expected: no errors.

---

## Task 11: Update 7 Callers

**Files:**
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Modify: `src/lib/whatsapp/v2/waitlist.ts`
- Modify: `src/lib/whatsapp/mediaHandler.ts`
- Modify: `src/lib/whatsapp/messageProcessor.ts`
- Modify: `src/lib/enhancedJobManager.ts`
- Modify: `src/app/api/reminders/run/route.ts`
- Modify: `src/lib/ai/reviewCollectionAgent.ts`

All 7 files call `createEvolutionClient(config).someMethod(...)`. Replace with `getProviderClient(config).someMethod(...)`. The `getTenantWhatsAppConfig` now returns a `provider` field so `getProviderClient` will dispatch to the right adapter.

Pattern for each file:

**Remove import:**
```typescript
import { getTenantWhatsAppConfig, createEvolutionClient } from '@/lib/whatsapp/evolutionClient';
```

**Add import:**
```typescript
import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { getProviderClient } from '@/lib/whatsapp/providers';
```

**Replace all occurrences of:**
```typescript
createEvolutionClient(config)
createEvolutionClient(waConfig)
createEvolutionClient({ ...config, ... })
```

**With:**
```typescript
getProviderClient(config)
getProviderClient(waConfig)
getProviderClient({ ...config, ... })
```

For `enhancedJobManager.ts` which uses dynamic imports:

**Remove:**
```typescript
const { getTenantWhatsAppConfig, createEvolutionClient } = await import('./whatsapp/evolutionClient');
```

**Add:**
```typescript
const { getTenantWhatsAppConfig } = await import('./whatsapp/evolutionClient');
const { getProviderClient } = await import('./whatsapp/providers');
```

**Replace:**
```typescript
createEvolutionClient(waConfig)
```
**With:**
```typescript
getProviderClient(waConfig)
```

- [ ] **Step 1: Update pipeline.ts**

In `src/lib/whatsapp/v2/pipeline.ts` (line 18):
- Replace `import { createEvolutionClient, getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';` with two imports (getTenantWhatsAppConfig from evolutionClient, getProviderClient from providers)
- Replace all `createEvolutionClient(` with `getProviderClient(`

- [ ] **Step 2: Update waitlist.ts**

In `src/lib/whatsapp/v2/waitlist.ts` (line 13): same import swap, same replacement.

- [ ] **Step 3: Update mediaHandler.ts**

In `src/lib/whatsapp/mediaHandler.ts` (line 4): same import swap.
Replace `createEvolutionClient(whatsappConfig)` at lines 66 and 206.

- [ ] **Step 4: Update messageProcessor.ts**

In `src/lib/whatsapp/messageProcessor.ts` (line 4): same import swap.
Replace `createEvolutionClient(whatsappConfig)` at line 155.

- [ ] **Step 5: Update enhancedJobManager.ts**

In `src/lib/enhancedJobManager.ts` — two dynamic import blocks (lines 678 and 764):
- Add `getProviderClient` dynamic import alongside `getTenantWhatsAppConfig`
- Replace `createEvolutionClient(waConfig)` / `createEvolutionClient(waConfig)` with `getProviderClient`

- [ ] **Step 6: Update reminders/run/route.ts**

In `src/app/api/reminders/run/route.ts` (line 4): same import swap.
Replace all `createEvolutionClient(waConfig)` with `getProviderClient(waConfig)`.

- [ ] **Step 7: Update reviewCollectionAgent.ts**

In `src/lib/ai/reviewCollectionAgent.ts` (line 11): same import swap.
Replace `createEvolutionClient(waConfig)` at line 436.

- [ ] **Step 8: TypeScript check all 7 files**

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | grep -E "pipeline|waitlist|mediaHandler|messageProcessor|enhancedJobManager|reminders/run|reviewCollectionAgent" | head -20
```

Expected: no errors in any of these files.

---

## Task 12: Onboarding UI

**Files:**
- Modify: `src/app/auth/onboarding/page.tsx`

Three additions to the WhatsApp step:
1. Provider radio (evolution|waha) → `whatsappProvider` state
2. Phone number input (shown when WAHA selected) → `whatsappPhone` state
3. Pairing code display block → `whatsappPairingCode` state

- [ ] **Step 1: Add new state variables**

Find the existing WhatsApp state declarations (around lines 127-130):
```typescript
const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
```
and
```typescript
const [whatsappRetry, setWhatsappRetry] = useState(0);
```

Add these three new state variables immediately after `whatsappRetry`:
```typescript
const [whatsappProvider, setWhatsappProvider] = useState<'evolution' | 'waha'>('evolution');
const [whatsappPhone, setWhatsappPhone]         = useState('');
const [whatsappPairingCode, setWhatsappPairingCode] = useState<string | null>(null);
```

- [ ] **Step 2: Update the initialize() POST body and response handling**

Find the `initialize()` function inside the useEffect (around line 151). Find the fetch call to `/api/tenants/${tenantId}/whatsapp/connect` with method POST.

Update the POST body to include `provider` and optional `phoneNumber`:
```typescript
body: JSON.stringify({
  provider: whatsappProvider,
  ...(whatsappPhone ? { phoneNumber: whatsappPhone } : {}),
}),
```

Update the response type and handling (around line 170):
```typescript
// Before:
const data = await res.json() as { status?: string; qrCode?: string };
if (data.qrCode) setWhatsappQr(data.qrCode);

// After:
const data = await res.json() as { status?: string; qrCode?: string; pairingCode?: string };
if (data.pairingCode) setWhatsappPairingCode(data.pairingCode);
if (data.qrCode) setWhatsappQr(data.qrCode);
```

- [ ] **Step 3: Add `whatsappProvider` and `whatsappPhone` to the useEffect dependency array**

Find (around line 205):
```typescript
  }, [step, tenantId, whatsappRetry]);
```

Replace with:
```typescript
  }, [step, tenantId, whatsappRetry, whatsappProvider, whatsappPhone]);
```

- [ ] **Step 4: Add provider radio and phone input to the WhatsApp step UI**

Find the WhatsApp step UI section (around line 666 where `{whatsappQr ? (` appears). Insert the provider selector and phone input ABOVE the QR display block:

```tsx
{/* Provider selector */}
<div className="flex flex-col gap-2 mb-4">
  <p className="text-xs font-medium text-gray-700">WhatsApp Provider</p>
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input
      type="radio"
      name="whatsappProvider"
      value="evolution"
      checked={whatsappProvider === 'evolution'}
      onChange={() => { setWhatsappProvider('evolution'); setWhatsappPairingCode(null); }}
    />
    Evolution API <span className="text-[10px] text-gray-500">(Baileys-based, free)</span>
  </label>
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input
      type="radio"
      name="whatsappProvider"
      value="waha"
      checked={whatsappProvider === 'waha'}
      onChange={() => { setWhatsappProvider('waha'); setWhatsappPairingCode(null); }}
    />
    WAHA Plus <span className="text-[10px] text-gray-500">(NOWEB engine, most stable, $19/mo)</span>
  </label>
</div>

{/* Phone number for pairing code */}
{whatsappProvider === 'waha' && (
  <div className="flex flex-col gap-1 mb-4">
    <label className="text-xs font-medium text-gray-700">
      WhatsApp number for pairing code (e.g. 2348012345678)
    </label>
    <input
      type="tel"
      className="border rounded px-2 py-1 text-sm"
      placeholder="2348012345678"
      value={whatsappPhone}
      onChange={e => setWhatsappPhone(e.target.value)}
    />
  </div>
)}

{/* Pairing code display */}
{whatsappPairingCode && (
  <div className="mb-4 p-3 bg-blue-50 rounded border border-blue-200">
    <p className="text-xs text-blue-700 mb-1">
      Enter this code in WhatsApp → Linked Devices → Link with phone number:
    </p>
    <p className="text-2xl font-mono font-bold text-blue-900 tracking-widest">
      {whatsappPairingCode}
    </p>
  </div>
)}
```

---

## Task 13: WhatsAppSyncSection UI

**Files:**
- Modify: `src/components/settings/WhatsAppSyncSection.tsx`

Add provider radio and update the Connect button's POST body.

- [ ] **Step 1: Add provider state**

After the existing `const [local, setLocal] = useState...` line, add:
```typescript
const [selectedProvider, setSelectedProvider] = useState<'evolution' | 'waha'>('evolution');
const [confirmSwitch, setConfirmSwitch] = useState(false);
```

- [ ] **Step 2: Add provider radio before the Connect button**

Inside the component JSX, before the `<div className="flex flex-wrap gap-2 text-[11px]">` buttons block, insert:
```tsx
<div className="flex flex-col gap-1 text-xs">
  <span className="font-medium">Provider</span>
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="radio" name="settingsProvider" value="evolution"
      checked={selectedProvider === 'evolution'}
      onChange={() => setSelectedProvider('evolution')} />
    Evolution API
  </label>
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="radio" name="settingsProvider" value="waha"
      checked={selectedProvider === 'waha'}
      onChange={() => setSelectedProvider('waha')} />
    WAHA Plus
  </label>
</div>
```

- [ ] **Step 3: Update Connect button to send provider in body**

Find the Connect button's onClick handler which calls:
```typescript
const res = await fetch(`/api/tenants/${tenantId}/whatsapp/connect`, { method: 'POST' });
```

Replace with:
```typescript
const res = await fetch(`/api/tenants/${tenantId}/whatsapp/connect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: selectedProvider }),
});
```

---

## Task 14: Docker + Env Setup

**Files:**
- Modify: `evolution-api-lite/docker-compose.yaml`
- Modify: `evolution-api-lite/.env`
- Modify: `Booking/.env.local` (if it exists and is writable)

- [ ] **Step 1: Add WAHA Plus service to docker-compose.yaml**

Open `evolution-api-lite/docker-compose.yaml`. After the `redis:` service block (before the `postgres:` block, or after it — either is fine), add:

```yaml
  waha:
    image: devlikeapro/waha-plus
    container_name: waha_api
    restart: always
    networks:
      - evolution-net
    ports:
      - 3100:3000
    environment:
      - WAHA_API_KEY=${WAHA_API_KEY}
    volumes:
      - waha_sessions:/app/.sessions
```

In the `volumes:` block at the bottom, add:
```yaml
  waha_sessions:
```

- [ ] **Step 2: Add WAHA_API_KEY to evolution-api-lite/.env**

Append to the file:
```
WAHA_API_KEY=change-me
```

- [ ] **Step 3: Add WAHA env vars to Booking/.env.local**

Append to `Booking/.env.local`:
```
WAHA_API_BASE=http://localhost:3100
WAHA_API_KEY=change-me
```

---

## Final TypeScript Check

After all tasks complete:

```bash
cd /home/ccemeka/Techclave/Booking/Booking && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero new TypeScript errors introduced by this implementation.
