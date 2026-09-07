export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import OwnerCaptureClient from './OwnerCaptureClient';

export default async function OwnerCapturePage() {
  await requireAuth(['owner', 'manager']);
  return <OwnerCaptureClient />;
}
