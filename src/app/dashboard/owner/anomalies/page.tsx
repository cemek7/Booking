export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import OwnerAnomaliesClient from './OwnerAnomaliesClient';

export default async function OwnerAnomaliesPage() {
  await requireAuth(['owner', 'manager']);
  return <OwnerAnomaliesClient />;
}
