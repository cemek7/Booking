export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import RetailOrdersWorkspace from '@/components/orders/RetailOrdersWorkspace';

export default async function OrdersPage() {
  await requireAuth(['owner', 'manager', 'staff']);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <RetailOrdersWorkspace />
    </div>
  );
}
