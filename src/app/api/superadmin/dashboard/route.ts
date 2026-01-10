import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

interface OperationalMetric {
  name: string;
  current: number;
  threshold: number;
  status: 'normal' | 'warning' | 'critical';
}

interface Incident {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  service: string;
  startedAt: string;
  status: 'active' | 'investigating' | 'resolved';
  owner?: string;
}

async function calculateBookingConflictRate(
  supabase: any,
  timeRange: string
): Promise<number> {
  const timeCondition = getTimeCondition(timeRange);

  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, resource_id, start_at, end_at, created_at')
      .eq('status', 'confirmed')
      .gte('created_at', timeCondition);

    if (error || !bookings) return 0;

    let conflicts = 0;
    for (let i = 0; i < bookings.length; i++) {
      for (let j = i + 1; j < bookings.length; j++) {
        const booking1 = bookings[i];
        const booking2 = bookings[j];

        if (booking1.resource_id === booking2.resource_id) {
          const start1 = new Date(booking1.start_at);
          const end1 = new Date(booking1.end_at);
          const start2 = new Date(booking2.start_at);
          const end2 = new Date(booking2.end_at);

          if (start1 < end2 && start2 < end1) {
            conflicts++;
          }
        }
      }
    }

    return bookings.length > 0 ? (conflicts / bookings.length) * 100 : 0;
  } catch (error) {
    console.error('Error calculating booking conflict rate:', error);
    return 0;
  }
}

async function calculateApiErrorRate(supabase: any): Promise<number> {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: logs, error } = await supabase
      .from('api_logs')
      .select('status_code')
      .gte('timestamp', fiveMinutesAgo);

    if (error || !logs) return 0;

    const totalRequests = logs.length;
    const errorRequests = logs.filter((log: any) => log.status_code >= 500).length;

    return totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
  } catch (error) {
    console.error('Error calculating API error rate:', error);
    return 0;
  }
}

async function calculatePaymentReconciliationDrift(supabase: any, timeRange: string): Promise<number> {
  const timeCondition = getTimeCondition(timeRange);

  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select(`
        id,
        amount_cents,
        psp_id,
        psp_transactions!inner(amount_cents)
      `)
      .gte('created_at', timeCondition);

    if (error || !transactions) return 0;

    let totalDelta = 0;
    let totalInternal = 0;

    transactions.forEach((transaction: any) => {
      const internalAmount = transaction.amount_cents;
      const pspAmount = transaction.psp_transactions?.[0]?.amount_cents || 0;

      totalDelta += Math.abs(internalAmount - pspAmount);
      totalInternal += internalAmount;
    });

    return totalInternal > 0 ? (totalDelta / totalInternal) * 100 : 0;
  } catch (error) {
    console.error('Error calculating payment reconciliation drift:', error);
    return 0;
  }
}

function getTimeCondition(timeRange: string): string {
  const now = new Date();
  let hoursBack = 24;

  switch (timeRange) {
    case '1h':
      hoursBack = 1;
      break;
    case '6h':
      hoursBack = 6;
      break;
    case '24h':
      hoursBack = 24;
      break;
    case '7d':
      hoursBack = 24 * 7;
      break;
    case '30d':
      hoursBack = 24 * 30;
      break;
  }

  return new Date(now.getTime() - hoursBack * 60 * 60 * 1000).toISOString();
}

export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const timeRange = url.searchParams.get('range') || '24h';
    const timeCondition = getTimeCondition(timeRange);

    const [
      bookingsCount,
      revenueData,
      conflictRate,
      apiErrorRate,
      paymentDrift,
      supportTickets,
      incidents,
      bookingConflicts,
      paymentMismatches
    ] = await Promise.all([
      ctx.supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed')
        .gte('created_at', timeCondition),

      ctx.supabase
        .from('transactions')
        .select('amount_cents')
        .eq('status', 'completed')
        .gte('created_at', timeCondition),

      calculateBookingConflictRate(ctx.supabase, timeRange),
      calculateApiErrorRate(ctx.supabase),
      calculatePaymentReconciliationDrift(ctx.supabase, timeRange),

      ctx.supabase
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open'),

      ctx.supabase
        .from('incidents')
        .select('*')
        .in('status', ['active', 'investigating'])
        .order('created_at', { ascending: false })
        .limit(10),

      ctx.supabase
        .from('booking_conflicts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),

      ctx.supabase
        .from('payment_mismatches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)
    ]);

    const totalRevenue =
      revenueData.data?.reduce((sum: number, transaction: any) => sum + (transaction.amount_cents || 0), 0) || 0;

    const kpis = [
      {
        title: 'Active Bookings',
        value: bookingsCount.count || 0,
        status: 'good' as const,
        icon: '📅',
        change: '+12%'
      },
      {
        title: 'Revenue',
        value: `$${(totalRevenue / 100).toLocaleString()}`,
        status: 'good' as const,
        icon: '💰',
        change: '+8%'
      },
      {
        title: 'Conversion Rate',
        value: '3.2%',
        status: 'good' as const,
        icon: '📈',
        change: '+0.3%'
      },
      {
        title: 'Conflict Rate',
        value: `${conflictRate.toFixed(2)}%`,
        status: (conflictRate > 0.1 ? 'warning' : 'good') as const,
        icon: '⚠️'
      },
      {
        title: 'Payment Drift',
        value: `${paymentDrift.toFixed(2)}%`,
        status: (paymentDrift > 0.5 ? 'critical' : 'good') as const,
        icon: '💳'
      },
      {
        title: 'API Error Rate',
        value: `${apiErrorRate.toFixed(2)}%`,
        status: (apiErrorRate > 1 ? 'critical' : 'good') as const,
        icon: '🚨'
      },
      {
        title: 'System Uptime',
        value: '99.9%',
        status: 'good' as const,
        icon: '✅'
      },
      {
        title: 'Support Tickets',
        value: supportTickets.count || 0,
        status: ((supportTickets.count || 0) > 10 ? 'warning' : 'good') as const,
        icon: '🎫'
      }
    ];

    const operationalMetrics: OperationalMetric[] = [
      {
        name: 'Webhook Queue Depth',
        current: 5,
        threshold: 50,
        status: 'normal'
      },
      {
        name: 'Database Connections',
        current: 15,
        threshold: 100,
        status: 'normal'
      },
      {
        name: 'API Response Time (95th percentile)',
        current: 250,
        threshold: 1000,
        status: 'normal'
      },
      {
        name: 'Calendar Sync Failures',
        current: 0,
        threshold: 5,
        status: 'normal'
      }
    ];

    const formattedIncidents: Incident[] = (incidents.data || []).map((incident: any) => ({
      id: incident.id,
      severity: incident.severity as 'low' | 'medium' | 'high' | 'critical',
      title: incident.title,
      service: incident.service || 'Unknown',
      startedAt: new Date(incident.created_at).toLocaleTimeString(),
      status: incident.status as 'active' | 'investigating' | 'resolved',
      owner: incident.owner
    }));

    const formattedConflicts = (bookingConflicts.data || []).map((conflict: any) => ({
      id: conflict.id,
      bookingIds: conflict.booking_ids || [],
      resource: conflict.resource_name || 'Unknown Resource',
      timeSlot: new Date(conflict.time_slot).toLocaleString(),
      status: conflict.status as 'pending' | 'resolved',
      resolvedAt: conflict.resolved_at
    }));

    const formattedMismatches = (paymentMismatches.data || []).map((mismatch: any) => ({
      id: mismatch.id,
      transactionId: mismatch.transaction_id,
      internalAmount: mismatch.internal_amount_cents,
      pspAmount: mismatch.psp_amount_cents,
      delta: mismatch.delta_cents,
      status: mismatch.status as 'pending' | 'resolved'
    }));

    return {
      kpis,
      operationalMetrics,
      incidents: formattedIncidents,
      bookingConflicts: formattedConflicts,
      paymentMismatches: formattedMismatches,
      lastUpdated: new Date().toLocaleString()
    };
  },
  'GET',
  { auth: true, roles: ['superadmin'] }
);