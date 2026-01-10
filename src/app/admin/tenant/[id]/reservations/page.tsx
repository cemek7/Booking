import ReservationForm from '@/components/ReservationForm';
import ReservationsList from '@/components/reservations/ReservationsList';

type Props = {
  params: { id: string };
};

export default function Page({ params }: Props) {
  const tenantId = params.id;
  return (
    <div className="max-w-4xl mx-auto py-6 grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <ReservationForm tenantId={tenantId} />
      </div>
      <div>
        <ReservationsList tenantId={tenantId} />
      </div>
    </div>
  );
}
