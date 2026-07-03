import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const fetchMock = jest.fn<typeof fetch>();
global.fetch = fetchMock as typeof fetch;

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
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_DEFAULT_FROM = 'noreply@mail.techclave.cloud';
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'secret';
    process.env.APP_URL = 'https://app.test';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'email_123' }),
      text: async () => '',
    } as Response);
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds RFC 8058 List-Unsubscribe headers when unsubscribe context is provided', async () => {
    isUnsubscribed.mockResolvedValue(false);
    await sendEmail({ to: unsub.recipient, subject: 's', html: 'h', unsubscribe: unsub });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { headers?: Record<string, string> };
    expect(payload.headers?.['List-Unsubscribe']).toMatch(/\/api\/email\/unsubscribe\?token=/);
    expect(payload.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('does not suppress transactional email even if unsubscribed', async () => {
    isUnsubscribed.mockResolvedValue(true);
    await sendEmail({ to: unsub.recipient, subject: 's', html: 'h', unsubscribe: unsub });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
