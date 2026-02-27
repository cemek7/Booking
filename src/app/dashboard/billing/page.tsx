import { requireAuth } from '@/lib/auth/server-auth';
import BillingClient from './BillingClient';

export default async function BillingPage() {
  // Owner-only — managers should not access billing
  await requireAuth(['owner'], true);
  return <BillingClient />;
}
