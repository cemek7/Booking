export const dynamic = 'force-dynamic';

import SupportDesk from '@/components/support/SupportDesk';
import { requireAuth } from '@/lib/auth/server-auth';

export default async function SupportPage() {
  const user = await requireAuth(['owner', 'manager', 'staff']);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <SupportDesk mode="tenant" role={user.role as 'owner' | 'manager' | 'staff'} />
    </div>
  );
}
