export const dynamic = 'force-dynamic';

import SupportDesk from '@/components/support/SupportDesk';
import { requireAuth } from '@/lib/auth/server-auth';

export default async function SuperadminSupportPage() {
  const user = await requireAuth(['superadmin']);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <SupportDesk mode="superadmin" role={user.role as 'superadmin'} />
    </div>
  );
}
