import { z } from 'zod';
import { normalizeInvitationEmail } from '@/lib/auth/tenant-invitations';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { checkRateLimit } from '@/lib/error-handling/migration-helpers';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { buildPublicUrl } from '@/lib/http/public-origin';

export const dynamic = 'force-dynamic';

const EmailChangeSchema = z.object({
  email: z.string().trim().email(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const parsed = EmailChangeSchema.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError({ email: 'Enter a valid email address' });

    const email = normalizeInvitationEmail(parsed.data.email);
    if (email === normalizeInvitationEmail(ctx.user?.email ?? '')) {
      throw ApiErrorFactory.badRequest('Enter a different email address');
    }

    const rateLimit = checkRateLimit(`account-email:${ctx.user!.id}`, 3, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
      throw ApiErrorFactory.tooManyRequests('Too many email-change requests. Try again later.');
    }

    const callbackUrl = buildPublicUrl(ctx.request, '/booka/auth/callback');
    callbackUrl.searchParams.set('finalize', '1');
    callbackUrl.searchParams.set('next', '/dashboard/settings?tab=security');

    const { error } = await ctx.supabase.auth.updateUser(
      { email },
      { emailRedirectTo: callbackUrl.toString() }
    );
    if (error) throw ApiErrorFactory.externalServiceError('Supabase Auth');

    return { ok: true, status: 'confirmation_sent' };
  },
  'POST',
  { auth: true, requireTenantMembership: false }
);
