export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import CloseReportsClient from './CloseReportsClient';

export default async function OwnerCloseReportsPage() {
  await requireAuth(['owner']);
  return <CloseReportsClient />;
}
