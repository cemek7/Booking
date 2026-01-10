import { requireAuth } from '@/lib/auth/server-auth';
import InteractiveCalendar from '@/components/calendar/InteractiveCalendar';

export default async function ManagerSchedulePage() {
  await requireAuth(['owner', 'manager']);

  return (
    <div className="p-6 h-full">
      <h1 className="text-2xl font-semibold mb-4">Manager Schedule</h1>
      <div style={{ height: 'calc(100vh - 150px)' }}>
        <InteractiveCalendar />
      </div>
    </div>
  );
}
