export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { getFreeModels } from '@/lib/openrouter-models';

/**
 * GET /api/admin/openrouter/models
 *
 * Returns the live list of free OpenRouter models (pricing.prompt === "0" AND pricing.completion === "0").
 * Results are cached in-memory for 60 minutes.
 *
 * Query params:
 *   ?refresh=true  — bust the cache and re-fetch from OpenRouter API
 *
 * Auth: owner, manager, superadmin
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    return getFreeModels(forceRefresh);
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
