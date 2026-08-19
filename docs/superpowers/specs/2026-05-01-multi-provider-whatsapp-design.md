# Multi-Provider WhatsApp Design

**Date:** 2026-05-01  
**Status:** Approved — post third review  
**Scope:** Add WAHA as a second WhatsApp provider alongside Evolution API, with per-tenant provider selection and the ability to switch providers.

---

## Problem

Evolution API Lite uses Baileys, which has had recurring device-linking failures. Tenants need a fallback provider with a more stable linking flow.

---

## Decision

**Option A — provider column + shared `WhatsAppProviderClient` interface + webhook normalizer.**  
One DB column selects the provider. ALL provider interactions (session management AND message sending) go through the interface. Callers replace `createEvolutionClient(config)` with `getProviderClient(config)` everywhere.

---

## Review History

### Round 1
| # | Issue | Fix |
|---|---|---|
| 1 | `connectionManager` hardwired to Evolution | Guard `startMonitoring()` behind `provider === 'evolution'` |
| 2 | GET connect route calls Evolution URL directly | Replace with `getProviderClient(config).getQrCode()` |
| 3 | WAHA `session.status` event unspecified | Added payload shape and status map |
| 4 | `WHATSAPP_HOOK_URL` env var can't resolve in docker-compose | Webhook URL set per-session at `createInstance()` time |
| 5 | Provider-switching never deleted old instance | `deleteInstance()` fire-and-forget before new instance |
| 6 | `WhatsAppSyncSection` sends no body | Provider radio + body added |

### Round 2
| # | Issue | Fix |
|---|---|---|
| 7 | `getTenantWhatsAppConfig` reads only `evolution_base_url`/`evolution_api_key` | Update to `provider_base_url ?? evolution_base_url` |
| 8 | `WhatsAppProviderClient` missing `sendTextMessage`/`sendMediaMessage` | Added to interface |
| 9 | `devlikeapro/waha` (free) uses Baileys — NOWEB requires `waha-plus` | Changed to `waha-plus` image |
| 10 | `webhook_events.external_id` had redundant provider prefix | Use `${instance}:${messageId}`, set `provider` field correctly |
| 11 | `getTenantIdByInstanceName` imported from `evolutionClient` | Moved to `providers/index.ts` |

### Round 3
| # | Issue | Fix |
|---|---|---|
| 12 | Migration number 068/069 already exist | Renamed to `070_whatsapp_provider.sql` |
| 13 | WAHA doesn't fire `qrcode.updated` — QR is in `session.status` with `status: "SCAN_QR_CODE"` | Normalizer extracts QR from `SCAN_QR_CODE` status and routes to qr_stored path |
| 14 | Onboarding has no `pairingCode` state or UI | Added `whatsappPairingCode` state + display block |
| 15 | Onboarding sends no `phoneNumber` in POST body | Added phone number input field to WhatsApp step |
| 16 | Missing files: `reminders/run/route.ts`, `reviewCollectionAgent.ts`, `enhancedJobManager.ts` | Added to Files Changed |
| 17 | `createEvolutionClient(config).sendTextMessage()` sends Evolution-specific paths even if baseUrl points to WAHA | All callers must replace `createEvolutionClient` with `getProviderClient` — updating baseUrl alone is not sufficient |

### Round 4
| # | Issue | Fix |
|---|---|---|
| 18 | `getTenantWhatsAppConfig` returns `EvolutionAPIConfig` with no `provider` field — `getProviderClient(config)` would always default to Evolution for every tenant | Add `provider` to `EvolutionAPIConfig` interface and to `getTenantWhatsAppConfig` return mapping (reads from DB row after migration 070) |
| 19 | Connect route POST is far more Evolution-coupled than "swap the factory" — module-level `EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY` constants, `if (!EVOLUTION_API_KEY)` guard, upsert columns, bare `fetch()` fallback QR call all hardcode Evolution | Full rewrite of POST handler: provider-conditional constants, Zod-validated body, provider-aware API key guard, factory-based instance creation |
| 20 | Connect route body typed as `Record<string, string>` — `provider` and `phoneNumber` have no validation | Replace with Zod schema: `{ instanceName?, webhookUrl?, provider?: 'evolution'\|'waha', phoneNumber? }` |
| 21 | `connectionManager.ts` has `forceReconnect()`, `getQRCode()`, `checkInstanceConnection()` that call `createEvolutionClient` directly — but these are safe: `forceReconnect`/`getQRCode` are dead code (no callers found in codebase); `checkInstanceConnection` is only reachable inside `startMonitoring()` which is already guarded | No changes needed to these methods — document WHY the `startMonitoring()` guard is sufficient |

---

## Data Layer

### Migration: `db/migrations/070_whatsapp_provider.sql`

```sql
ALTER TABLE whatsapp_configurations
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evolution'
    CHECK (provider IN ('evolution', 'waha')),
  ADD COLUMN IF NOT EXISTS provider_base_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_api_key  TEXT;
```

`evolution_base_url` and `evolution_api_key` kept. All code reads:
```typescript
baseUrl: config.provider_base_url ?? config.evolution_base_url,
apiKey:  config.provider_api_key  ?? config.evolution_api_key,
```

`instance_name` reused as WAHA session name.  
`messages.evolution_message_id` stores any provider's message ID.  
`whatsapp_connections` unchanged.

---

## Provider Client Abstraction

### Location
`src/lib/whatsapp/providers/`

### Files
| File | Purpose |
|---|---|
| `types.ts` | `WhatsAppProviderClient` interface + `ProviderConfig` type |
| `evolution.ts` | Wraps `EvolutionAPIClient` from `evolutionClient.ts` |
| `waha.ts` | WAHA REST client |
| `index.ts` | `getProviderClient(config)` factory + re-exports `getTenantIdByInstanceName` |

### Full Interface

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
  sendTextMessage(to: string, text: string, quotedMessageId?: string): Promise<{
    success: boolean;
    messageId?: string;
  }>;
  sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type?: 'image' | 'document' | 'audio' | 'video'
  ): Promise<{ success: boolean; messageId?: string }>;
}

export interface ProviderConfig {
  provider: 'evolution' | 'waha';
  baseUrl: string;        // provider_base_url ?? evolution_base_url
  apiKey: string;         // provider_api_key ?? evolution_api_key
  instanceName: string;
}
```

### WAHA API mapping

| Method | WAHA endpoint | Notes |
|---|---|---|
| `createInstance` | `POST /api/sessions` | Body: `{ name, config: { webhooks: [{ url, events, customHeaders }] } }` |
| `getConnectionStatus` | `GET /api/sessions/{name}` | `status === 'WORKING'` → connected |
| `getQrCode` | `GET /api/sessions/{name}/qr` | Returns `{ value: "data:image/png;base64,..." }` |
| `requestPairingCode` | `POST /api/sessions/{name}/auth/request-code` | Body: `{ phoneNumber }` → `{ code }` |
| `deleteInstance` | `DELETE /api/sessions/{name}` | |
| `sendTextMessage` | `POST /api/sendText` | Body: `{ session, chatId: "${to}@c.us", text }` |
| `sendMediaMessage` | `POST /api/sendImage` / `POST /api/sendFile` | Body: `{ session, chatId, file: { url, mimetype } }` |

WAHA auth header: `X-Api-Key: <key>` (NOT `apikey`).

### `EvolutionAPIConfig` and `getTenantWhatsAppConfig` update (in `evolutionClient.ts`)

`EvolutionAPIConfig` must include `provider` so that `getProviderClient(config)` knows which adapter to return. Without it every caller defaults to Evolution regardless of the tenant's actual config.

```typescript
// Add to interface
export interface EvolutionAPIConfig {
  provider?: 'evolution' | 'waha';   // NEW — defaults to 'evolution' if absent
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl?: string;
}
```

`getTenantWhatsAppConfig` return mapping:
```typescript
// Before (Evolution-only):
baseUrl: data.evolution_base_url,
apiKey:  data.evolution_api_key,

// After (provider-aware — migration 070 adds provider/provider_base_url/provider_api_key):
provider: (data.provider ?? 'evolution') as 'evolution' | 'waha',
baseUrl:  data.provider_base_url ?? data.evolution_base_url,
apiKey:   data.provider_api_key  ?? data.evolution_api_key,
```

All callers of `getTenantWhatsAppConfig` then pass the result to `getProviderClient(config)` — the `provider` field ensures the right adapter is returned.

### Callers that must replace `createEvolutionClient` with `getProviderClient`

All of these call `createEvolutionClient(waConfig).sendTextMessage(...)`. After the change they call `getProviderClient(waConfig).sendTextMessage(...)`:

- `src/lib/whatsapp/v2/pipeline.ts`
- `src/lib/whatsapp/v2/waitlist.ts`
- `src/lib/whatsapp/mediaHandler.ts`
- `src/lib/whatsapp/messageProcessor.ts`
- `src/lib/enhancedJobManager.ts`
- `src/app/api/reminders/run/route.ts`
- `src/lib/ai/reviewCollectionAgent.ts`

---

## Connect Route Changes

### POST `/api/tenants/[tenantId]/whatsapp/connect`

The current handler has **multiple Evolution-hardcoded spots** that all need replacing — not just the client factory:
- Module-level `EVOLUTION_BASE_URL` / `EVOLUTION_API_KEY` constants
- `if (!EVOLUTION_API_KEY)` guard (hardcodes Evolution as the only valid config)
- Upsert writing `evolution_base_url` / `evolution_api_key` columns
- `createEvolutionClient({ baseUrl: EVOLUTION_BASE_URL, ... })` call
- Bare `fetch()` fallback QR call to `${EVOLUTION_BASE_URL}/instance/connect/...`

**New body schema (Zod-validated):**
```typescript
const ConnectBodySchema = z.object({
  instanceName: z.string().optional(),
  webhookUrl:   z.string().url().optional(),
  provider:     z.enum(['evolution', 'waha']).optional(),
  phoneNumber:  z.string().optional(),
});
```

**New flow:**
1. Parse + validate body with `ConnectBodySchema`
2. Read existing config (if any) — get current `provider`
3. Determine effective provider: `body.provider ?? existingConfig?.provider ?? 'evolution'`
4. Resolve base URL + API key from env by provider:
   - `evolution` → `EVOLUTION_API_BASE` / `EVOLUTION_API_KEY`
   - `waha`      → `WAHA_API_BASE` / `WAHA_API_KEY`
5. Validate that the provider's API key is configured (provider-specific error message)
6. If provider changed → `getProviderClient(existingConfig).deleteInstance()` fire-and-forget + clear connection row
7. Upsert `whatsapp_configurations` writing `provider`, `provider_base_url`, `provider_api_key` (keep legacy columns for backward compat)
8. `getProviderClient(newConfig).createInstance(webhookUrl, secret)`
9. If `phoneNumber` → `requestPairingCode(phoneNumber)`, include in response
10. Return `{ status, qrCode?, pairingCode?, instanceName, webhookUrl }`

`connectionManager.startMonitoring()` only called for `provider === 'evolution'`.

**Why `startMonitoring()` guard is sufficient for `connectionManager`:**  
`connectionManager` has three other Evolution-coupled methods (`forceReconnect`, `getQRCode`, `checkInstanceConnection`) but none are reachable for WAHA tenants: `forceReconnect` and `getQRCode` have zero callers in the codebase; `checkInstanceConnection` is only reachable through `startMonitoring()` which is already guarded. No changes needed inside `connectionManager` beyond the guard.

### GET `/api/tenants/[tenantId]/whatsapp/connect`

Replace:
```typescript
// Before
const qrResponse = await fetch(`${config.evolution_base_url}/instance/connect/${config.instance_name}`, ...)

// After
const client = getProviderClient({ provider: config.provider, baseUrl: ..., apiKey: ..., instanceName: config.instance_name });
qrCode = await client.getQrCode();
```

---

## Webhook Normalizer

**New canonical file:** `src/app/api/webhooks/whatsapp/route.ts`  
**Alias:** `src/app/api/webhooks/evolution/route.ts` re-exports POST — existing instances work without reconfiguration.

Both share `EVOLUTION_WEBHOOK_SECRET`. WAHA sessions configured with `customHeaders: { "x-evolution-secret": process.env.EVOLUTION_WEBHOOK_SECRET }` at `createInstance` time.

### Payload shapes and normalization

**Evolution inbound message (`messages.upsert`):**
```json
{ "instance": "name", "event": "messages.upsert",
  "data": { "key": { "id": "MSG_ID", "fromMe": false, "remoteJid": "2348...@s.whatsapp.net" },
            "message": { "conversation": "Hello" }, "messageTimestamp": 1234567890 } }
```

**WAHA inbound message (`message`):**
```json
{ "session": "name", "event": "message",
  "payload": { "id": { "_serialized": "MSG_ID", "fromMe": false },
               "from": "2348...@c.us", "body": "Hello", "timestamp": 1234567890 } }
```

**Evolution connection update (`connection.update`):**
```json
{ "instance": "name", "event": "connection.update", "data": { "state": "open" } }
```

**WAHA session status (`session.status`) — handles BOTH connection updates AND QR:**
```json
{ "session": "name", "event": "session.status",
  "payload": { "status": "WORKING" } }

{ "session": "name", "event": "session.status",
  "payload": { "status": "SCAN_QR_CODE",
               "qr": { "value": "data:image/png;base64,..." } } }
```

WAHA status map:
| WAHA status | Internal action |
|---|---|
| `WORKING` | `connection.update` → `open` |
| `STOPPED` / `FAILED` | `connection.update` → `close` |
| `STARTING` | `connection.update` → `connecting` |
| `SCAN_QR_CODE` | Extract `payload.qr.value` → store as `qr_code` in `whatsapp_connections` (same path as Evolution's `qrcode.updated`) |

**Evolution QR (`qrcode.updated`):**
```json
{ "instance": "name", "event": "qrcode.updated",
  "data": { "qrcode": { "base64": "data:image/png;base64,..." } } }
```

Both QR paths write to `whatsapp_connections.qr_code` via the same upsert.

### Idempotency

`webhook_events` insert:
```typescript
{
  provider: detectedProvider,  // 'evolution' or 'waha'
  external_id: `${instanceName}:${messageId}`,
  ...
}
```

DB `UNIQUE(provider, external_id)` prevents cross-provider collisions. No prefix redundancy.

### Guards
- Zod validates normalised shape before v2 pipeline
- Unknown event type → log warning + return `200`
- `getTenantIdByInstanceName` imported from `providers/index.ts`

---

## WAHA Docker Setup

### Image

`devlikeapro/waha` (free/Core) = **Baileys internally** = same linking instability.  
`devlikeapro/waha-plus` (paid) = **NOWEB engine** = no Baileys protocol reimplementation.  
**Use `devlikeapro/waha-plus`.** Pricing: $19/month (1 instance) or $49/month (unlimited).

### `evolution-api-lite/docker-compose.yaml`

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

# Add to volumes block:
  waha_sessions:
```

### Env additions

**`evolution-api-lite/.env`:**
```
WAHA_API_KEY=change-me
```

**`Booking/.env.local`:**
```
WAHA_API_BASE=http://localhost:3100
WAHA_API_KEY=change-me
```

---

## UI Changes

### Onboarding — WhatsApp step (`src/app/auth/onboarding/page.tsx`)

**New state:**
```typescript
const [whatsappProvider, setWhatsappProvider] = useState<'evolution' | 'waha'>('evolution');
const [whatsappPhone, setWhatsappPhone] = useState('');
const [whatsappPairingCode, setWhatsappPairingCode] = useState<string | null>(null);
```

**Provider selector** (shown before connect button):
```
○ Evolution API   (Baileys-based, self-hosted, free)
● WAHA Plus       (NOWEB engine, most stable, $19/mo)
```

**Phone input** (shown when WAHA selected, optional):
```
WhatsApp number for pairing code (e.g. 2348012345678)
```

**POST body update:**
```typescript
body: JSON.stringify({ provider: whatsappProvider, ...(whatsappPhone ? { phoneNumber: whatsappPhone } : {}) })
```

**Pairing code display** (shown when `pairingCode` in response):
```
Enter this code in WhatsApp > Linked Devices > Link with phone number:
[ X X X X - X X X X ]
```

**QR display** unchanged (shown when `qrCode` in response).

`initialize()` response type updated:
```typescript
const data = await res.json() as { status?: string; qrCode?: string; pairingCode?: string };
if (data.pairingCode) setWhatsappPairingCode(data.pairingCode);
if (data.qrCode) setWhatsappQr(data.qrCode);
```

### Settings — `src/components/settings/WhatsAppSyncSection.tsx`

- Add provider radio (same two options)
- Connect button body: `JSON.stringify({ provider: selectedProvider })`
- Show switch-provider confirmation before changing

---

## Complete Files Changed

| File | Change |
|---|---|
| `db/migrations/070_whatsapp_provider.sql` | **New** — adds 3 columns |
| `src/lib/whatsapp/providers/types.ts` | **New** |
| `src/lib/whatsapp/providers/evolution.ts` | **New** |
| `src/lib/whatsapp/providers/waha.ts` | **New** |
| `src/lib/whatsapp/providers/index.ts` | **New** — factory + re-exports `getTenantIdByInstanceName` |
| `src/lib/whatsapp/evolutionClient.ts` | **Edit** — `getTenantWhatsAppConfig` reads `provider_base_url ?? evolution_base_url`; re-exports `getTenantIdByInstanceName` |
| `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts` | **Edit** — provider field, factory dispatch, switch flow, connectionManager guard |
| `src/app/api/webhooks/whatsapp/route.ts` | **New** — canonical normalizing webhook handler |
| `src/app/api/webhooks/evolution/route.ts` | **Edit** — re-export POST from whatsapp route |
| `src/lib/whatsapp/connectionManager.ts` | **Edit** — guard `startMonitoring()` behind `provider === 'evolution'` |
| `src/lib/whatsapp/v2/pipeline.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/lib/whatsapp/v2/waitlist.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/lib/whatsapp/mediaHandler.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/lib/whatsapp/messageProcessor.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/lib/enhancedJobManager.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/app/api/reminders/run/route.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/lib/ai/reviewCollectionAgent.ts` | **Edit** — `createEvolutionClient` → `getProviderClient` |
| `src/app/auth/onboarding/page.tsx` | **Edit** — provider radio, phone input, pairingCode state + display |
| `src/components/settings/WhatsAppSyncSection.tsx` | **Edit** — provider radio + POST body |
| `evolution-api-lite/docker-compose.yaml` | **Edit** — WAHA Plus service + volume |
| `evolution-api-lite/.env` | **Edit** — `WAHA_API_KEY` |

**Total: 21 files (5 new, 16 edits)**

---

## Backward Compatibility

- Existing rows default to `provider = 'evolution'` — zero impact
- `getTenantWhatsAppConfig` falls back to legacy columns when `provider_base_url` is null
- `/api/webhooks/evolution` alias keeps all existing Evolution instances working
- `connectionManager.startMonitoring()` unchanged for Evolution tenants
- `getTenantIdByInstanceName` still importable from `evolutionClient.ts` (re-export)
- All 7 callers of `createEvolutionClient` that we update still work identically for Evolution tenants (Evolution adapter wraps the same `EvolutionAPIClient`)

---

## What Does NOT Change

- `whatsapp_connections` table
- `messages` table (`evolution_message_id` reused for WAHA IDs)
- v2 pipeline logic
- Secret validation logic
- `activateV2()` in connect route
- All booking, staff, services APIs

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| WAHA replies fail silently | `sendTextMessage` in interface; all callers use `getProviderClient` |
| WAHA QR never arrives (no `qrcode.updated`) | Normalizer handles `SCAN_QR_CODE` inside `session.status` |
| Pairing code shown but user has no UI to see it | `pairingCode` state + display block in onboarding |
| Wrong event drops messages | Zod validates; unknown events log + 200 |
| Provider switch orphans old instance | `deleteInstance()` fire-and-forget |
| WAHA Core (Baileys) used accidentally | Spec requires `waha-plus` image explicitly |
| `connectionManager` crashes on WAHA config | Guarded behind `provider === 'evolution'` |
| Migration number collision | Using `070_whatsapp_provider.sql` |
