export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server-auth';
import ReviewModerationQueue from '@/components/moderation/ReviewModerationQueue';

export default async function ModerationPage() {
  // Owners and managers can moderate reported reviews.
  await requireAuth(['owner', 'manager']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Review moderation</h1>
      <p className="text-sm text-gray-600">Reported reviews awaiting action.</p>
      <div className="mt-6 max-w-2xl">
        <ReviewModerationQueue />
      </div>
    </div>
  );
}
