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
  it('picks paystack for NGN and stripe otherwise', async () => {
    const adapter = new PaymentsAdapter({});
    const paystackProvider = (adapter as any).pickProvider('NGN');
    const stripeProvider = (adapter as any).pickProvider('USD');
    expect(paystackProvider?.name).toBe('paystack');
    expect(stripeProvider?.name).toBe('stripe');
  });
});
