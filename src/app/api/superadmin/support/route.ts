export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status');
    const admin = createSupabaseAdminClient();

    let query = admin
      .from('support_tickets')
      .select('*, tenants(name)')
      .order('updated_at', { ascending: false });

    if (status === 'open' || status === 'pending' || status === 'resolved' || status === 'closed') {
      query = query.eq('status', status);
    }

    const [{ data: tickets, error }, { data: allTickets, error: allError }] = await Promise.all([
      query,
      admin.from('support_tickets').select('status'),
    ]);
    if (error) throw error;
    if (allError) throw allError;

    const counts = {
      open: 0,
      pending: 0,
      resolved: 0,
      closed: 0,
    };

    for (const ticket of allTickets ?? []) {
      const key = ticket.status as keyof typeof counts;
      if (key in counts) {
        counts[key] += 1;
      }
    }

    return { tickets: tickets ?? [], counts };
  },
  'GET',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false }
);
