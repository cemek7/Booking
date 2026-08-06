export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import OwnerApprovalsClient from './OwnerApprovalsClient';

export default async function OwnerApprovalsPage() {
  await requireAuth(['owner', 'manager']);
  return <OwnerApprovalsClient />;
}
