import { requireAuth } from '@/lib/auth/server-auth';
import BillingClient from './BillingClient';

export default async function BillingPage() {
  /**
   * Owner-only access:
   * Billing surfaces sensitive payment methods and full invoice history.
   * Only workspace owners may manage billing; managers are intentionally
   * excluded to protect financial data.  If a non-owner reaches this page,
   * `requireAuth` redirects them with an appropriate unauthorised response.
   */
  await requireAuth(['owner'], true);
  return <BillingClient />;
}
