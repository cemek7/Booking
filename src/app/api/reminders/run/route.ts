export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { runRemindersForTenant } from '@/lib/reminders/runner';

/**
 * POST /api/reminders/run
 *
 * Process and send pending reminders for the AUTHENTICATED tenant. This endpoint:
 * 1. Queries reminders with status 'pending' and remind_at <= now
 * 2. Sends WhatsApp messages via the configured WhatsApp provider
 * 3. Updates reminder status (sent/failed) and attempt count
 *
 * The all-tenants scheduled equivalent (cron) lives at /api/cron/reminders — both share
 * runRemindersForTenant() so behavior is identical.
 */

export const POST = createHttpHandler(
  async (ctx) => {
    // Derive tenant from authenticated user; reject any header override
    const tenantId = ctx.user!.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    return await runRemindersForTenant(ctx.supabase, tenantId);
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
