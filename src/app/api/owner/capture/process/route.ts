export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { runCaptureQueueWithAdmin } from '@/lib/capture/jobRunner';

export const POST = createHttpHandler(
  async () => {
    return runCaptureQueueWithAdmin(10);
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);

