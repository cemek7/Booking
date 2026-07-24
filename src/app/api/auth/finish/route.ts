export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { defaultLogger } from '@/lib/logger';

const FinishAuthSchema = z.object({
  session: z.object({
    user: z.object({
      id: z.string().min(1),
      email: z.string().email().optional(),
    }),
  }),
});

/**
 * Finalize authentication flow
 * POST /api/auth/finish
 *
 * Creates or updates user record after successful authentication.
 * Called by auth callback to persist user data.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    try {
      const raw = await ctx.request.json();
      const parsed = FinishAuthSchema.safeParse(raw);
      if (!parsed.success) {
        throw ApiErrorFactory.validationError('Missing or invalid session data');
      }
      const { session } = parsed.data;

      const userId = session.user.id;
      const email = session.user.email;

      // Identity lives in auth.users + tenant_users; no public.users mirror to sync.

      return {
        success: true,
        message: 'Authentication finalized',
        userId,
        email,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Missing')) {
        throw error;
      }
      defaultLogger.error('[auth/finish] unexpected error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to finalize authentication'));
    }
  },
  'POST',
  { auth: false } // Public endpoint
);
