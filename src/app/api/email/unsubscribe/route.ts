export const dynamic = 'force-dynamic';

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
import { recordUnsubscribe } from '@/lib/email/preferences';

/** Secret used to sign unsubscribe tokens. Falls back to existing app secrets. */
function unsubscribeSecret(): string {
  return (
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.WEBHOOK_SIGNATURE_SECRET ||
    process.env.JWT_SECRET ||
    ''
  );
}

async function processToken(token: string | null | undefined) {
  const secret = unsubscribeSecret();
  if (!secret) throw ApiErrorFactory.validationError({ config: 'unsubscribe secret not configured' });
  if (!token) throw ApiErrorFactory.validationError({ token: 'token is required' });

  const payload = verifyUnsubscribeToken(token, secret);
  if (!payload) throw ApiErrorFactory.validationError({ token: 'invalid or tampered token' });

  const admin = createSupabaseAdminClient();
  await recordUnsubscribe(admin, {
    tenantId: payload.tenantId,
    recipient: payload.recipient,
    list: payload.list,
  });
  return { success: true, unsubscribed: true, list: payload.list, recipient: payload.recipient };
}

/**
 * GET /api/email/unsubscribe?token=...
 * Direct one-click unsubscribe (clicked from an email link). Public (auth:false).
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const token = new URL(ctx.request.url).searchParams.get('token');
    return processToken(token);
  },
  'GET',
  { auth: false },
);

/**
 * POST /api/email/unsubscribe  { token }
 * RFC 8058 List-Unsubscribe-Post one-click + the /unsubscribe page fetch. Public.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const body: { token?: string } = await parseJsonBody<{ token?: string }>(ctx.request).catch(() => ({}));
    return processToken(body.token);
  },
  'POST',
  { auth: false },
);
