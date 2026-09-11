import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * A promo code exists in plaintext for exactly one moment. Delivery has to
 * either work or say loudly that it did not, because there is no second
 * attempt — the caller keeps the code on screen based on what this reports.
 */

const mockSend = jest.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>();
jest.mock('@/lib/integrations/email-service', () => ({
  sendTransactionalEmail: (...a: unknown[]) => mockSend(...a),
}));

const mockResolveOwner = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/billing/walletAlerts', () => ({
  resolveTenantOwner: (...a: unknown[]) => mockResolveOwner(...a),
}));

import {
  buildPromoEmail,
  deliverPromoCode,
  resolvePromoRecipients,
} from '@/lib/billing/walletPromoDelivery';
import type { SupabaseClient } from '@supabase/supabase-js';

const admin = {} as SupabaseClient;

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ success: true });
  mockResolveOwner.mockResolvedValue({ email: 'owner@salon.ng', phone: null });
});

describe('buildPromoEmail', () => {
  it('carries the code and how to redeem it', () => {
    const mail = buildPromoEmail({ code: 'SUMMER26', campaign: 'Launch', amountCredits: 500 });
    expect(mail.text).toContain('SUMMER26');
    expect(mail.html).toContain('SUMMER26');
    expect(mail.text).toContain('Billing');
  });

  it('escapes a campaign name so it cannot inject markup into the email', () => {
    const mail = buildPromoEmail({
      code: 'SUMMER26',
      campaign: '<img src=x onerror="alert(1)">',
      amountCredits: 500,
    });
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img');
  });

  it('says there is no expiry rather than printing an empty date', () => {
    const mail = buildPromoEmail({ code: 'A', campaign: 'C', amountCredits: 1, expiresAt: null });
    expect(mail.text).toContain('No expiry date');
  });

  it('warns that the code cannot be sent again', () => {
    const mail = buildPromoEmail({ code: 'A', campaign: 'C', amountCredits: 1 });
    expect(mail.text).toContain('cannot be sent again');
  });
});

describe('resolvePromoRecipients', () => {
  it('adds the tenant owner when a tenant is named', async () => {
    const to = await resolvePromoRecipients({ admin, tenantId: 't1' });
    expect(to).toEqual(['owner@salon.ng']);
  });

  it('collapses a duplicate so nobody receives the same code twice', async () => {
    const to = await resolvePromoRecipients({ admin, tenantId: 't1', emails: ['OWNER@salon.ng'] });
    expect(to).toEqual(['owner@salon.ng']);
  });

  it('returns nothing when no recipient was chosen', async () => {
    expect(await resolvePromoRecipients({ admin })).toEqual([]);
    expect(mockResolveOwner).not.toHaveBeenCalled();
  });

  it('still works when the tenant has no owner on file', async () => {
    mockResolveOwner.mockResolvedValue(null);
    const to = await resolvePromoRecipients({ admin, tenantId: 't1', emails: ['a@b.co'] });
    expect(to).toEqual(['a@b.co']);
  });
});

describe('deliverPromoCode', () => {
  const base = { code: 'SUMMER26', campaign: 'Launch', amountCredits: 500 };

  it('reports that nothing was attempted when there is no recipient', async () => {
    const out = await deliverPromoCode({ ...base, recipients: [] });
    expect(out).toEqual({ attempted: false, sentTo: [], failed: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends one message per recipient, so no tenant sees another', async () => {
    await deliverPromoCode({ ...base, recipients: ['a@b.co', 'c@d.co'] });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls.every(([opts]) => typeof (opts as { to: string }).to === 'string')).toBe(true);
  });

  it('reports a failed address instead of pretending the code was delivered', async () => {
    mockSend.mockResolvedValueOnce({ success: false, error: 'bounced' });
    const out = await deliverPromoCode({ ...base, recipients: ['bad@b.co'] });
    expect(out.sentTo).toEqual([]);
    expect(out.failed).toEqual([{ email: 'bad@b.co', error: 'bounced' }]);
  });

  it('treats a suppressed send as a failure — a silent drop would lose the code', async () => {
    mockSend.mockResolvedValueOnce({ success: true, suppressed: true });
    const out = await deliverPromoCode({ ...base, recipients: ['optout@b.co'] });
    expect(out.sentTo).toEqual([]);
    expect(out.failed[0].error).toBe('suppressed');
  });

  it('keeps going after one address throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('network down'));
    const out = await deliverPromoCode({ ...base, recipients: ['bad@b.co', 'good@b.co'] });
    expect(out.failed).toHaveLength(1);
    expect(out.sentTo).toEqual(['good@b.co']);
  });
});
