"use client";
import ReservationsList from '@/components/reservations/ReservationsList';
import ReservationsCalendar from '@/components/ReservationsCalendar';
import ReservationForm from '@/components/ReservationForm';
import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import type SupabaseLite from '@/types/supabase';

export default function TenantDashboardPage() {
  // use the shared supabase client (anon key) on the client; session metadata should be available
  // NOTE: for stricter security, derive tenantId server-side during SSR/edge calls.
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
  const supabase = getBrowserSupabase() as unknown as SupabaseLite;
    async function loadSession() {
      const ses = await supabase.auth?.getSession?.();
      if (!mounted) return;
  const session = (ses as { data?: { session?: { user?: Record<string, unknown>; } } } | null)?.data?.session ?? null;
  // Expect user metadata or claims to contain tenant_id
  const t = ((session?.user?.user_metadata as Record<string, unknown> | undefined)?.['tenant_id'] as string | undefined) || (session?.user?.aud as string) || null;
      setTenantId(t as string | null);
    }
    loadSession();
    return () => { mounted = false; };
  }, []);

  if (!tenantId) {
    return (
      <div className="p-6">Please sign in to see your tenant dashboard.</div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Tenant Dashboard</h1>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <ReservationsCalendar tenantId={tenantId} onDayClick={(iso) => setSelectedDate(iso)} selectedDate={selectedDate} />
        </div>
        <div className="col-span-1 space-y-4">
          <div>
            <ReservationForm tenantId={tenantId} defaultDateIso={selectedDate} onCreated={() => { /* Could navigate to details */ setSelectedDate(undefined); }} />
          </div>
          <div>
            <ReservationsList tenantId={tenantId} />
          </div>
        </div>
      </div>
    </div>
  );
}
