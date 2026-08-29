import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const settleOutboundMessage = jest.fn() as jest.Mock<() => Promise<void>>;
const resolveChargeTenantByWamid = jest.fn() as jest.Mock<() => Promise<string | null>>;
jest.mock('@/lib/billing/messageWallet', () => ({
  settleOutboundMessage, resolveChargeTenantByWamid,
}));

import { settleStatusEvent } from '@/app/api/webhooks/whatsapp/meta/route';

const admin = {} as never;

describe('settleStatusEvent', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('forwards Meta pricing verbatim on delivered', async () => {
    await settleStatusEvent(admin, 't1', {
      id: 'wamid.A',
      status: 'delivered',
      pricing: { billable: true, pricing_model: 'PMP', category: 'service', type: 'paid' },
    });
    expect(settleOutboundMessage).toHaveBeenCalledWith({
      admin, tenantId: 't1', wamid: 'wamid.A', deliveryStatus: 'delivered',
      pricing: { billable: true, pricing_model: 'PMP', category: 'service', type: 'paid' },
    });
  });

  it('forwards failed with no pricing', async () => {
    await settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'failed' });
    expect(settleOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: 'failed', pricing: undefined }),
    );
  });

  it('ignores a status with no id', async () => {
    await settleStatusEvent(admin, 't1', { status: 'delivered' });
    expect(settleOutboundMessage).not.toHaveBeenCalled();
  });

  it('ignores an unrecognised status verb', async () => {
    await settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'deleted' });
    expect(settleOutboundMessage).not.toHaveBeenCalled();
  });

  it('never throws when settlement fails', async () => {
    settleOutboundMessage.mockRejectedValueOnce(new Error('db down'));
    await expect(
      settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'delivered' }),
    ).resolves.toBeUndefined();
  });

  it('does not invent a billable verdict Meta did not send', async () => {
    // Booka charges from Meta's own pricing object, never from a local model of
    // Meta's rules. A delivered status with no pricing must arrive at
    // settlement as undefined, not as a guessed `billable: true`.
    await settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'delivered' });
    const call = settleOutboundMessage.mock.calls[0][0] as { pricing?: unknown };
    expect(call.pricing).toBeUndefined();
  });
});

describe('settleStatusEvent — shared-gateway tenant resolution', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolves the tenant from the charge row when the webhook has none', async () => {
    // Shared-gateway traffic has no whatsapp_configurations row, so this webhook
    // cannot map phone_number_id to a tenant — but those sends ARE metered.
    // Skipping them would reserve credit that never settles.
    resolveChargeTenantByWamid.mockResolvedValue('t-shared');
    await settleStatusEvent(admin, null, { id: 'wamid.A', status: 'delivered' });
    expect(resolveChargeTenantByWamid).toHaveBeenCalledWith(admin, 'wamid.A');
    expect(settleOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-shared' }),
    );
  });

  it('does not resolve when the webhook already knows the tenant', async () => {
    await settleStatusEvent(admin, 't1', { id: 'wamid.A', status: 'delivered' });
    expect(resolveChargeTenantByWamid).not.toHaveBeenCalled();
  });

  it('settles nothing when no charge row claims the wamid', async () => {
    resolveChargeTenantByWamid.mockResolvedValue(null);
    await settleStatusEvent(admin, null, { id: 'wamid.A', status: 'delivered' });
    expect(settleOutboundMessage).not.toHaveBeenCalled();
  });
});
