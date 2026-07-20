import type { SupabaseClient } from '@supabase/supabase-js';
import { findCustomerByPhone, normalizePhone } from '@/lib/customers/identity';

export interface CustomerRecall {
  lastService: string | null;
  usualStaff: string | null;
  lastVisitAt: string | null;
  visitCount: number;
  rebookingDue: boolean;
}

type VisitRow = {
  start_at: string | null;
  status: string | null;
  service_id: string | null;
  tenant_staff_id: string | null;
  services:
    | { name?: string | null; rebooking_interval_days?: number | null }
    | Array<{ name?: string | null; rebooking_interval_days?: number | null }>
    | null;
};

const EXCLUDED_STATUSES = ['cancelled', 'no_show', 'refunded', 'refund_pending'];
const DAY_MS = 24 * 60 * 60 * 1000;

function readService(row: VisitRow) {
  const payload = row.services;
  return Array.isArray(payload) ? (payload[0] ?? null) : (payload ?? null);
}

/**
 * Tenant-scoped recall for a returning WhatsApp customer.
 * Returns null for unknown/new customers or on any error.
 */
export async function getCustomerRecall(
  admin: SupabaseClient,
  tenantId: string,
  phone: string,
): Promise<CustomerRecall | null> {
  try {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;

    const customer = await findCustomerByPhone(admin, tenantId, normalizedPhone, 'id, last_visit, merged_into');
    if (!customer?.id) return null;

    const { data: rows } = await admin
      .from('reservations')
      .select('start_at, status, service_id, tenant_staff_id, services(name, rebooking_interval_days)')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.id)
      .lt('start_at', new Date().toISOString())
      .order('start_at', { ascending: false })
      .limit(20);

    const visits = ((rows ?? []) as VisitRow[]).filter(
      (row) => !row.status || !EXCLUDED_STATUSES.includes(row.status)
    );
    if (visits.length === 0) return null;

    const lastService = readService(visits[0])?.name ?? null;

    const counts = new Map<string, number>();
    for (const visit of visits) {
      if (visit.tenant_staff_id) {
        counts.set(visit.tenant_staff_id, (counts.get(visit.tenant_staff_id) ?? 0) + 1);
      }
    }

    let favoriteStaffId: string | null = null;
    let favoriteCount = 0;
    for (const [staffId, count] of counts.entries()) {
      if (count > favoriteCount) {
        favoriteStaffId = staffId;
        favoriteCount = count;
      }
    }

    let usualStaff: string | null = null;
    if (favoriteStaffId && favoriteCount >= 2) {
      const { data: staffRow } = await admin
        .from('tenant_users')
        .select('name')
        .eq('id', favoriteStaffId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      usualStaff = typeof staffRow?.name === 'string' ? staffRow.name : null;
    }

    const lastVisitAt = customer.last_visit ?? visits[0].start_at ?? null;
    const rebookingIntervalDays = readService(visits[0])?.rebooking_interval_days ?? null;
    const rebookingDue = Boolean(
      rebookingIntervalDays
      && lastVisitAt
      && Date.now() - Date.parse(lastVisitAt) >= rebookingIntervalDays * DAY_MS,
    );

    return {
      lastService,
      usualStaff,
      lastVisitAt,
      visitCount: visits.length,
      rebookingDue,
    };
  } catch (error) {
    console.warn('[customerRecall] getCustomerRecall failed', error);
    return null;
  }
}
