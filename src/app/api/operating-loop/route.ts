import { createHttpHandler, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { getLoop } from '@/lib/operating-loop/service';

export const dynamic = 'force-dynamic';

export const GET = createHttpHandler(
  async (ctx) => getLoop(getVerifiedTenantId(ctx)),
  'GET',
  { auth: true, roles: ['owner'] },
);
