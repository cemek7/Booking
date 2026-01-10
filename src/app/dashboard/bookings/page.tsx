import { requireAuth } from '@/lib/auth/server-auth';
import ReservationsList from '@/components/reservations/ReservationsList';

export default async function BookingsPage() {
  await requireAuth(['owner', 'manager', 'staff']);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Bookings</h1>
      <p className="text-sm text-gray-600">List and manage reservations for the selected tenant.</p>
      <div className="mt-6">
        <ReservationsList />
      </div>
    </div>
  );
}
