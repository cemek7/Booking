export const dynamic = 'force-dynamic';

import ListeningConfigForm from '@/components/listening/ListeningConfigForm';
import MentionsFeed from '@/components/listening/MentionsFeed';
import { requireAuth } from '@/lib/auth/server-auth';

export default async function MentionsPage() {
  await requireAuth(['owner', 'manager']);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Social mentions</h1>
        <p className="mt-2 text-sm text-slate-600">
          Track public business mentions, mark them engaged, or convert them into leads when contact details are captured.
        </p>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div>
          <ListeningConfigForm />
        </div>
        <div className="max-w-3xl">
          <MentionsFeed />
        </div>
      </div>
    </div>
  );
}
