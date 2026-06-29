import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const send = jest.fn<() => Promise<unknown>>(() =>
  Promise.resolve([{ statusCode: 202, headers: { 'x-message-id': 'id' } }]),
);
jest.mock('@sendgrid/mail', () => ({ __esModule: true, default: { setApiKey: jest.fn(), send } }));

const isUnsubscribed = jest.fn<() => Promise<boolean>>();
jest.mock('@/lib/email/preferences', () => ({
  isUnsubscribed: (...a: unknown[]) => isUnsubscribed(...(a as [])),
}));
jest.mock('@/lib/supabase/server', () => ({ createSupabaseAdminClient: () => ({}) }));

import { sendEmail } from '@/lib/integrations/email-service';

const unsub = { tenantId: 't1', recipient: 'ada@example.com', list: 'marketing' };

describe('sendEmail — unsubscribe + suppression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'k';
    process.env.SENDGRID_FROM_EMAIL = 'noreply@boka.com';
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'secret';
    process.env.APP_URL = 'https://app.test';
  });

  it('suppresses marketing email to an unsubscribed recipient (no send)', async () => {
    isUnsubscribed.mockResolvedValue(true);
    const res = (await sendEmail({
      to: unsub.recipient,
      subject: 's',
      html: 'h',
      marketing: true,
      unsubscribe: unsub,
    })) as { suppressed?: boolean };
    expect(res.suppressed).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('adds RFC 8058 List-Unsubscribe headers when unsubscribe context is provided', async () => {
    isUnsubscribed.mockResolvedValue(false);
    await sendEmail({ to: unsub.recipient, subject: 's', html: 'h', unsubscribe: unsub });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as { headers?: Record<string, string> };
    expect(msg.headers?.['List-Unsubscribe']).toMatch(/\/api\/email\/unsubscribe\?token=/);
    expect(msg.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('does not suppress transactional email even if unsubscribed', async () => {
    isUnsubscribed.mockResolvedValue(true);
    await sendEmail({ to: unsub.recipient, subject: 's', html: 'h', unsubscribe: unsub });
    expect(send).toHaveBeenCalledTimes(1); // marketing flag absent → still sends
  });
});
