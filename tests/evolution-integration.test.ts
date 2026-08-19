/**
 * Canonical WhatsApp webhook integration smoke.
 *
 * This suite validates the current production surface without requiring a live
 * provider connection or seeded tenant data:
 *   - provider webhook provisioning points at /api/webhooks/whatsapp/[tenantId]
 *   - tenant-scoped webhook route exists for Evolution, WAHA, and Meta payloads
 */

import { describe, it, expect } from '@jest/globals';
import { buildProviderWebhookUrl } from '@/lib/whatsapp/wahaProvisioning';

const APP_URL = process.env.INTEGRATION_APP_URL ?? 'http://127.0.0.1:3008';
const TENANT_ID = '00000000-0000-0000-0000-000000000000';

function buildEvolutionPayload(instanceName = 'test-instance', messageId = 'test-message', text = 'hello', phone = '2348099999999') {
  return {
    instance: instanceName,
    data: {
      key: {
        remoteJid: `${phone}@s.whatsapp.net`,
        fromMe: false,
        id: messageId,
      },
      message: {
        conversation: text,
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
}

function buildWahaPayload(session = 'default', messageId = 'test-message', body = 'hello', phone = '2348099999999') {
  return {
    session,
    event: 'message',
    payload: {
      id: { _serialized: messageId, fromMe: false },
      from: `${phone}@c.us`,
      body,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'chat',
    },
  };
}

function buildMetaPayload(messageId = 'test-message', phone = '2348099999999') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                display_phone_number: phone,
                phone_number_id: 'phone-number-id',
              },
              messages: [
                {
                  from: phone,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'hello' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('Canonical WhatsApp webhook surface', () => {
  it.each([
    ['evolution' as const],
    ['waha' as const],
    ['meta' as const],
  ])('provisions %s webhooks onto the tenant-scoped path', (provider) => {
    expect(buildProviderWebhookUrl('https://booka.example/api/webhooks/whatsapp', provider, TENANT_ID))
      .toBe(`https://booka.example/api/webhooks/whatsapp/${TENANT_ID}`);
  });

  it('returns tenant-scoped not-configured for Evolution payloads', async () => {
    const payload = buildEvolutionPayload();
    const res = await fetch(`${APP_URL}/api/webhooks/whatsapp/${TENANT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('tenant_whatsapp_not_configured');
  });

  it('returns tenant-scoped not-configured for WAHA payloads', async () => {
    const payload = buildWahaPayload();
    const res = await fetch(`${APP_URL}/api/webhooks/whatsapp/${TENANT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('tenant_whatsapp_not_configured');
  });

  it('returns tenant-scoped not-configured for Meta payloads', async () => {
    const payload = buildMetaPayload();
    const res = await fetch(`${APP_URL}/api/webhooks/whatsapp/${TENANT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('tenant_whatsapp_not_configured');
  });
});
