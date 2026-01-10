import { requireAuth } from '@/lib/auth/server-auth';
import InteractiveCalendar from '@/components/calendar/InteractiveCalendar';

export default async function OwnerSchedulePage() {
  await requireAuth(['owner']);

  return (
    <div className="p-6 h-full">
      <h1 className="text-2xl font-semibold mb-4">Owner Schedule</h1>
      <div style={{ height: 'calc(100vh - 150px)' }}>
        <InteractiveCalendar />
      </div>
    </div>
  );
}
