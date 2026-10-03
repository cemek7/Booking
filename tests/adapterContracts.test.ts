// Jest globals are available without import
import { MessagingAdapter } from '@/lib/messagingAdapter';
import { PaymentsAdapter } from '@/lib/paymentsAdapter';

describe('MessagingAdapter contract', () => {
  it('fails for disabled channel', async () => {
    const adapter = new MessagingAdapter({ whatsapp: false, email: false });
    const res = await adapter.sendMessage({ tenant_id: 't1', channel: 'whatsapp', to: '123', body: 'Hi' });
    expect(res.status).toBe('failed');
    expect(res.error).toBe('channel_not_enabled');
  });
});

describe('PaymentsAdapter contract', () => {
  it('no longer registers a Paystack provider (tenant Paystack goes through tenantSettlement)', async () => {
    const adapter = new PaymentsAdapter({});
    const pick = (adapter as unknown as { pickProvider(currency: string): { name?: string } | undefined }).pickProvider.bind(adapter);
    expect(pick('NGN')?.name).not.toBe('paystack');
    expect((adapter as unknown as { providers: Record<string, unknown> }).providers.paystack).toBeUndefined();
  });
});
