import { requireAuth } from '@/lib/auth/server-auth';
import BillingClient from './BillingClient';

export default async function BillingPage() {
  await requireAuth(['owner', 'manager']);
  return <BillingClient />;
}
