import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const reserveOutboundMessage = jest.fn();
const attachWamid = jest.fn();
const abandonCharge = jest.fn();
const triggerWalletHandoff = jest.fn();

jest.mock('@/lib/billing/messageWallet', () => ({
  reserveOutboundMessage, attachWamid, abandonCharge,
}));
jest.mock('@/lib/billing/messageHandoff', () => ({ triggerWalletHandoff }));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => ({ __admin: true }) }));

import { withMetering } from '@/lib/whatsapp/providers/metered';
import { getProviderClient } from '@/lib/whatsapp/providers/factory';

type SendResult = { success: boolean; messageId?: string };

function makeInner(result: SendResult) {
  return {
    sendTextMessage: jest.fn(async () => result),
    sendTemplateMessage: jest.fn(async () => result),
    sendMediaMessage: jest.fn(async () => result),
    sendInteractiveMessage: jest.fn(async () => result),
    createInstance: jest.fn(async () => ({ status: 'configured' })),
    getConnectionStatus: jest.fn(async () => ({ connected: true })),
    getQrCode: jest.fn(async () => null),
    requestPairingCode: jest.fn(async () => null),
    deleteInstance: jest.fn(async () => undefined),
  };
}

const opts = { tenantId: 't1', provider: 'meta', channel: 'whatsapp' as const };

describe('withMetering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: 'c1', mode: 'paid' });
  });

  it('attaches the wamid after a successful send', async () => {
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, opts);
    const r = await client.sendTextMessage('2348012345678', 'hi');
    expect(r).toMatchObject({ success: true, messageId: 'wamid.A' });
    expect(attachWamid).toHaveBeenCalledWith(expect.anything(), 'c1', 'wamid.A');
    expect(abandonCharge).not.toHaveBeenCalled();
  });

  it('abandons the charge when the send fails', async () => {
    const inner = makeInner({ success: false });
    const client = withMetering(inner as never, opts);
    const r = await client.sendTextMessage('2348012345678', 'hi');
    expect(r.success).toBe(false);
    expect(abandonCharge).toHaveBeenCalledWith(expect.anything(), 'c1');
    expect(attachWamid).not.toHaveBeenCalled();
  });

  it('hands off and does not send when the reservation is refused', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: false, reason: 'handoff' });
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, opts);
    const r = await client.sendTextMessage('2348012345678', 'hi');
    expect(r.success).toBe(false);
    expect(inner.sendTextMessage).not.toHaveBeenCalled();
    expect(triggerWalletHandoff).toHaveBeenCalledWith(expect.anything(), 't1', '2348012345678', 'whatsapp');
  });

  it('passes the channel through to the handoff so instagram is not sent over whatsapp', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: false, reason: 'handoff' });
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, { ...opts, provider: 'instagram', channel: 'instagram' });
    await client.sendTextMessage('17841400000000000', 'hi');
    expect(triggerWalletHandoff).toHaveBeenCalledWith(
      expect.anything(), 't1', '17841400000000000', 'instagram',
    );
  });

  it('meters all four send methods with the right message kind', async () => {
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, opts);
    await client.sendTextMessage('234', 'hi');
    await client.sendTemplateMessage('234', 'tpl');
    await client.sendMediaMessage('234', { url: 'u', mimetype: 'image/png' } as never);
    await client.sendInteractiveMessage('234', { type: 'button' } as never);
    expect(reserveOutboundMessage).toHaveBeenCalledTimes(4);
    expect(reserveOutboundMessage.mock.calls.map((c) => (c[0] as { messageKind: string }).messageKind))
      .toEqual(['freeform', 'template', 'media', 'interactive']);
  });

  it('passes non-send methods straight through without metering', async () => {
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, opts);
    await client.getConnectionStatus();
    expect(inner.getConnectionStatus).toHaveBeenCalled();
    expect(reserveOutboundMessage).not.toHaveBeenCalled();
  });

  it('skips attachWamid when the reservation returned a null chargeId', async () => {
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: null, mode: 'grace' });
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, opts);
    const r = await client.sendTextMessage('234', 'hi');
    expect(r.success).toBe(true);
    expect(attachWamid).not.toHaveBeenCalled();
    expect(abandonCharge).not.toHaveBeenCalled();
  });

  it('abandons the charge when the send succeeds without a messageId', async () => {
    // The provider accepted the send but returned an unparseable body. Without a
    // wamid the charge row is invisible to the sweeper (which filters
    // wamid IS NOT NULL), so doing nothing here strands the credits forever.
    const inner = makeInner({ success: true });
    const client = withMetering(inner as never, opts);
    const r = await client.sendTextMessage('234', 'hi');
    expect(r.success).toBe(true);
    expect(attachWamid).not.toHaveBeenCalled();
    expect(abandonCharge).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('still sends when metering itself throws', async () => {
    reserveOutboundMessage.mockRejectedValue(new Error('metering exploded'));
    const inner = makeInner({ success: true, messageId: 'wamid.A' });
    const client = withMetering(inner as never, opts);
    const r = await client.sendTextMessage('234', 'hi');
    expect(r).toMatchObject({ success: true });
    expect(inner.sendTextMessage).toHaveBeenCalled();
  });
});

describe('getProviderClient metering gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: 'c1', mode: 'paid' });
  });

  const base = { provider: 'meta' as const, baseUrl: 'https://x', apiKey: 'k', instanceName: 'i' };

  it('meters a config that carries a tenantId', async () => {
    const client = getProviderClient({ ...base, tenantId: 't1' });
    await client.sendTextMessage('234', 'hi').catch(() => undefined);
    expect(reserveOutboundMessage).toHaveBeenCalled();
  });

  it('leaves a platform config with no tenantId unmetered', async () => {
    const client = getProviderClient(base);
    await client.sendTextMessage('234', 'hi').catch(() => undefined);
    expect(reserveOutboundMessage).not.toHaveBeenCalled();
  });
});

// The handoff sends through getTenantWhatsAppProviderClientUnmetered. If that
// ever became metered, an empty wallet would refuse the handoff, which would
// call the handoff again, and so on. Its config now carries a tenantId (that is
// what gates metering everywhere else), so "unmetered" is no longer implied by
// the data — only by this function bypassing getProviderClient. Pinned on
// purpose rather than left to a comment.
jest.mock('@/lib/whatsapp/evolutionClient', () => ({
  getTenantWhatsAppConfig: jest.fn(async (tenantId: string) => ({
    provider: 'meta', baseUrl: 'https://x', apiKey: 'k', instanceName: 'i', tenantId,
  })),
}));

describe('recursion guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reserveOutboundMessage.mockResolvedValue({ allow: true, chargeId: 'c1', mode: 'paid' });
  });

  it('never meters the unmetered client, even though its config names a tenant', async () => {
    const { getTenantWhatsAppProviderClientUnmetered } = await import(
      '@/lib/whatsapp/providers/unmetered'
    );
    const client = await getTenantWhatsAppProviderClientUnmetered('t1');
    expect(client).not.toBeNull();
    await client!.sendTextMessage('234', 'hi').catch(() => undefined);
    expect(reserveOutboundMessage).not.toHaveBeenCalled();
    expect(triggerWalletHandoff).not.toHaveBeenCalled();
  });
});
