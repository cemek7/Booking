export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import OwnerStockCountsClient from './OwnerStockCountsClient';

export default async function OwnerStockCountsPage() {
  await requireAuth(['owner', 'manager', 'staff']);
  return <OwnerStockCountsClient />;
}
