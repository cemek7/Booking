export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import { Metadata } from 'next';
import ReservationsList from '@/components/reservations/ReservationsList';

export const metadata: Metadata = {
  title: 'Reservations | Booka Superadmin',
};

export default async function SuperadminReservationsPage() {
  await requireAuth(['superadmin']);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Reservations</h1>
      <ReservationsList />
    </div>
  );
}
