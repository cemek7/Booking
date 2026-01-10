import { useRouter } from "next/navigation";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import Button from "../ui/button";
import { toast } from '../ui/toast';
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch, authDelete } from "@/lib/auth/auth-api-client";

async function fetchBookings(tenantId: string) {
  if (!tenantId) return [];
  const response = await authFetch('/api/bookings', { tenantId });
  if (response.error) throw new Error('Failed bookings fetch');
  return response.data || [];
}

function BookingsList() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ['bookings-list', tenant?.id],
    queryFn: () => fetchBookings(tenant?.id || ''),
    enabled: !!tenant?.id
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await authDelete(`/api/bookings?id=eq.${id}`, { tenantId: tenant?.id });
      if (response.error) throw new Error('Delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings-list', tenant?.id] }),
    onError: () => toast.error('Failed to delete booking')
  });
  const router = useRouter();

  const handleEdit = (id: number) => {
    router.push(`/dashboard/bookings/${id}`);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Are you sure you want to delete this booking?')) return;
    deleteMutation.mutate(id);
  };

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error loading bookings.</p>;

  return (
    <div>
      <Table>
        <THead>
          <TR>
            <TH>ID</TH>
            <TH>Title</TH>
            <TH>Status</TH>
            <TH>Capacity</TH>
            <TH>Start Date</TH>
            <TH>End Date</TH>
            <TH>&nbsp;</TH>
          </TR>
        </THead>
        <TBody>
          {data && data.length > 0 ? (
            data.map((b: any) => (
              <TR key={b.id}>
                <TD>{b.id}</TD>
                <TD>{b.title}</TD>
                <TD>{b.status}</TD>
                <TD>{b.capacity}</TD>
                <TD>{b.start_date}</TD>
                <TD>{b.end_date}</TD>
                <TD>
                  <Button className="mr-2 px-2 py-1 text-xs" onClick={() => handleEdit(b.id)}>Edit</Button>
                  <Button className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600" onClick={() => handleDelete(b.id)}>Delete</Button>
                </TD>
              </TR>
            ))
          ) : (
            <TR>
              <TD colSpan={7} className="text-center">No bookings found.</TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}

export default BookingsList;
