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
  it('picks paystack as MVP default for all currencies', async () => {
    const adapter = new PaymentsAdapter({});
    const paystackProvider = (adapter as any).pickProvider('NGN');
    const usdProvider = (adapter as any).pickProvider('USD');
    // Paystack is the MVP default; it handles all currencies unless tenant overrides
    expect(paystackProvider?.name).toBe('paystack');
    expect(usdProvider?.name).toBe('paystack');
  });
});
