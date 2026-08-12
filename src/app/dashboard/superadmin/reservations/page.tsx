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
      <p className="mb-6 max-w-2xl text-sm text-slate-600">Platform-wide reservation operations. Filter by tenant from a tenant detail or use this view to find and safely cancel an individual reservation.</p>
      <ReservationsList />
    </div>
  );
}
