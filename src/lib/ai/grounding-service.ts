import { createClient } from '@supabase/supabase-js';
import type { ConvState } from '@/lib/whatsapp/v2/conversationState';
import type { FrontDeskIntent, IntentRoute } from './intent-router';
import { getAvailableSlots } from '@/lib/whatsapp/v2/slotEngine';
import { getCustomerRecall, type CustomerRecall } from './customerRecall';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TenantContext = {
  id: string;
  name: string | null;
  settings: Record<string, unknown> | null;
  buffer_minutes: number | null;
  timezone: string | null;
};

type ServiceContext = {
  id: string;
  name: string;
  price_cents: number | null;
  duration_minutes: number | null;
};

type StaffContext = {
  id: string;
  phone: string | null;
  name?: string | null;
};

type ProductContext = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price_cents?: number | null;
  currency?: string | null;
  is_featured?: boolean;
  stock_quantity?: number | null;
  track_inventory?: boolean;
};

type ShowcaseContext = {
  id: string;
  name: string;
  template_kind?: string | null;
  description?: string | null;
  intro_message?: string | null;
  fallback_cta?: string | null;
  trigger_phrases?: string[] | null;
};

type LeadContext = {
  id: string;
  status?: string | null;
  intent?: string | null;
  notes?: string | null;
  follow_up_at?: string | null;
  followed_up_at?: string | null;
};

export interface GroundingResult {
  route: IntentRoute;
  tenant: TenantContext | null;
  services: ServiceContext[];
  staff: StaffContext[];
  products: ProductContext[];
  showcasePacks: ShowcaseContext[];
  customerRecall: CustomerRecall | null;
  leadContext: LeadContext | null;
  availableSlots: Array<{ staffId: string; slots: string[] }>;
  bookings: Array<Record<string, unknown>>;
  ownerSummary: Record<string, unknown> | null;
  timezone: string;
  dateRange?: { start: string; end: string; label: string };
}

export async function getGroundingData(
  tenantId: string,
  message: string,
  conv: ConvState,
  route: IntentRoute
): Promise<GroundingResult> {
  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('id, name, metadata, tone_config, buffer_minutes, timezone')
    .eq('id', tenantId)
    .maybeSingle();

  const tenant = tenantRow ? {
    id: String(tenantRow.id),
    name: typeof tenantRow.name === 'string' ? tenantRow.name : null,
    settings: normalizeTenantSettings(tenantRow.metadata, tenantRow.tone_config),
    buffer_minutes: typeof tenantRow.buffer_minutes === 'number' ? tenantRow.buffer_minutes : null,
    timezone: typeof tenantRow.timezone === 'string' ? tenantRow.timezone : null,
  } satisfies TenantContext : null;

  const { data: serviceRows } = await supabaseAdmin
    .from('services')
    .select('id, name, price, duration')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order');

  const services = normalizeServices(serviceRows);

  const { data: staff } = await supabaseAdmin
    .from('tenant_users')
    .select('id, phone, name')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'staff']);

  const customerRecall = conv.role === 'customer' && conv.phone_number
    ? await getCustomerRecall(supabaseAdmin, tenantId, conv.phone_number)
    : null;
  const leadContext = conv.role === 'customer' && conv.phone_number
    ? await getLeadContext(tenantId, conv.phone_number)
    : null;
  const salesGrounding = await getSalesGrounding(tenantId, message, route.intent);
  const dateRange = resolveDateRange(message);
  const bookings = await getRelevantBookings(tenantId, route.intent, dateRange);
  const ownerSummary = route.intent === 'owner_query'
    ? await getOwnerSummary(tenantId, message, dateRange)
    : null;

  const availableSlots = await getAvailabilitySnapshot(
    tenantId,
    message,
    route.intent,
    conv,
    services ?? [],
    staff ?? []
  );

  return {
    route,
    tenant,
    services,
    staff: (staff as StaffContext[] | null) ?? [],
    products: salesGrounding.products,
    showcasePacks: salesGrounding.showcasePacks,
    customerRecall,
    leadContext,
    availableSlots,
    bookings,
    ownerSummary,
    timezone: tenant?.timezone ?? 'Africa/Lagos',
    dateRange,
  };
}

function normalizeTenantSettings(
  metadata: unknown,
  toneConfig: unknown,
): Record<string, unknown> | null {
  const normalizedMetadata = metadata && typeof metadata === 'object'
    ? { ...(metadata as Record<string, unknown>) }
    : {};

  if (toneConfig && typeof toneConfig === 'object') {
    normalizedMetadata.tone_config = toneConfig;
  }

  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : null;
}

function normalizeServices(data: unknown): ServiceContext[] {
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      const record = row as Record<string, unknown>;
      const price = typeof record.price === 'number' ? record.price : Number(record.price ?? 0);
      const duration = typeof record.duration === 'number' ? record.duration : Number(record.duration ?? 60);

      return {
        id: String(record.id),
        name: String(record.name ?? 'Unnamed Service'),
        price_cents: Number.isFinite(price) ? Math.round(price * 100) : 0,
        duration_minutes: Number.isFinite(duration) ? duration : 60,
      } satisfies ServiceContext;
    })
    .filter((service) => Boolean(service.id));
}

async function getRelevantBookings(
  tenantId: string,
  intent: FrontDeskIntent,
  dateRange: { start: string; end: string; label: string }
): Promise<Array<Record<string, unknown>>> {
  if (!['owner_query', 'cancel_booking', 'reschedule_booking'].includes(intent)) {
    return [];
  }

  const { data } = await supabaseAdmin
    .from('reservations')
    .select('id, customer_id, customer_number, start_at, end_at, status, tenant_staff_id, service_id')
    .eq('tenant_id', tenantId)
    .gte('start_at', `${dateRange.start}T00:00:00`)
    .lt('start_at', `${dateRange.end}T23:59:59`)
    .order('start_at');

  return (data as Array<Record<string, unknown>> | null) ?? [];
}

async function getSalesGrounding(
  tenantId: string,
  message: string,
  intent: FrontDeskIntent
): Promise<{ products: ProductContext[]; showcasePacks: ShowcaseContext[] }> {
  const likelySalesQuestion = intent === 'sales_inquiry'
    || intent === 'lead_qualification'
    || intent === 'upsell_opportunity'
    || intent === 'lead_recovery'
    || /\b(product|products|item|items|catalog|catalogue|showcase|portfolio|gallery|price list|retail)\b/i.test(message);

  if (!likelySalesQuestion) {
    return { products: [], showcasePacks: [] };
  }

  const [products, showcasePacks] = await Promise.all([
    getProductsForGrounding(tenantId, message),
    getShowcasePacksForGrounding(tenantId, message),
  ]);

  return { products, showcasePacks };
}

async function getLeadContext(
  tenantId: string,
  phone: string
): Promise<LeadContext | null> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('id, status, intent, notes, follow_up_at, followed_up_at')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (!data?.id) return null;

  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : null,
    intent: typeof data.intent === 'string' ? data.intent : null,
    notes: typeof data.notes === 'string' ? data.notes : null,
    follow_up_at: typeof data.follow_up_at === 'string' ? data.follow_up_at : null,
    followed_up_at: typeof data.followed_up_at === 'string' ? data.followed_up_at : null,
  };
}

async function getProductsForGrounding(
  tenantId: string,
  message: string
): Promise<ProductContext[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, name, description, short_description, price_cents, currency, is_featured, stock_quantity, track_inventory')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('is_featured', { ascending: false })
      .order('name', { ascending: true })
      .limit(12);

    if (error || !data) return [];

    const normalizedMessage = message.toLowerCase();
    const rows = (data as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name ?? 'Unnamed Product'),
        description: typeof row.short_description === 'string'
          ? row.short_description
          : (typeof row.description === 'string' ? row.description : null),
        category: null,
        price_cents: typeof row.price_cents === 'number' ? row.price_cents : Number(row.price_cents ?? 0),
        currency: typeof row.currency === 'string' ? row.currency : null,
        is_featured: Boolean(row.is_featured),
        stock_quantity: typeof row.stock_quantity === 'number' ? row.stock_quantity : Number(row.stock_quantity ?? 0),
        track_inventory: typeof row.track_inventory === 'boolean' ? row.track_inventory : Boolean(row.track_inventory),
      }))
      .filter((row) => row.id);

    const matched = rows.filter((row) =>
      normalizedMessage.includes(row.name.toLowerCase())
      || (row.description ? normalizedMessage.includes(row.description.toLowerCase()) : false)
    );

    return (matched.length > 0 ? matched : rows).slice(0, 6);
  } catch {
    return [];
  }
}

async function getShowcasePacksForGrounding(
  tenantId: string,
  message: string
): Promise<ShowcaseContext[]> {
  const normalizedMessage = message.toLowerCase();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_showcase_packs')
    .select('id, name, template_kind, description, intro_message, fallback_cta, trigger_phrases')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .limit(6);

  if (error || !data) return [];

  const rows = (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? 'Showcase Pack'),
    template_kind: typeof row.template_kind === 'string' ? row.template_kind : null,
    description: typeof row.description === 'string' ? row.description : null,
    intro_message: typeof row.intro_message === 'string' ? row.intro_message : null,
    fallback_cta: typeof row.fallback_cta === 'string' ? row.fallback_cta : null,
    trigger_phrases: Array.isArray(row.trigger_phrases) ? row.trigger_phrases.map(String) : null,
  }));

  const matched = rows.filter((row) =>
    normalizedMessage.includes(row.name.toLowerCase())
    || (row.template_kind ? normalizedMessage.includes(row.template_kind.toLowerCase()) : false)
    || row.trigger_phrases?.some((phrase) => normalizedMessage.includes(phrase.toLowerCase()))
  );

  return (matched.length > 0 ? matched : rows).slice(0, 4);
}

async function getOwnerSummary(
  tenantId: string,
  message: string,
  dateRange: { start: string; end: string; label: string }
): Promise<Record<string, unknown> | null> {
  const summary: Record<string, unknown> = {};
  const normalized = message.toLowerCase();

  const { data: dailyRows } = await supabaseAdmin
    .from('tenant_daily_summary')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('date', dateRange.start)
    .lte('date', dateRange.end)
    .order('date', { ascending: false });

  if (dailyRows && dailyRows.length > 0) {
    summary.period = {
      label: dateRange.label,
      start: dateRange.start,
      end: dateRange.end,
      bookings_count: dailyRows.reduce((sum, row) => sum + Number(row.bookings_count ?? 0), 0),
      completed_count: dailyRows.reduce((sum, row) => sum + Number(row.completed_count ?? 0), 0),
      cancelled_count: dailyRows.reduce((sum, row) => sum + Number(row.cancelled_count ?? 0), 0),
      no_show_count: dailyRows.reduce((sum, row) => sum + Number(row.no_show_count ?? 0), 0),
      estimated_revenue: dailyRows.reduce((sum, row) => sum + Number(row.estimated_revenue ?? 0), 0),
    };
    summary.daily_rows = dailyRows.slice(0, 7);
  } else {
    const { data: legacyRows } = await supabaseAdmin
      .from('insights_daily')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', dateRange.start)
      .lte('date', dateRange.end)
      .order('date', { ascending: false });
    if (legacyRows && legacyRows.length > 0) {
      summary.period = {
        label: dateRange.label,
        start: dateRange.start,
        end: dateRange.end,
        bookings_count: legacyRows.reduce((sum, row) => sum + Number(row.total_bookings ?? 0), 0),
        completed_count: legacyRows.reduce((sum, row) => sum + Number(row.completed ?? 0), 0),
        cancelled_count: legacyRows.reduce((sum, row) => sum + Number(row.cancelled ?? 0), 0),
        no_show_count: legacyRows.reduce((sum, row) => sum + Number(row.no_shows ?? 0), 0),
        estimated_revenue: legacyRows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0),
      };
      summary.daily_rows = legacyRows.slice(0, 7);
    }
  }

  if (/\b(top customer|best customer|loyal customer|stopped coming|at risk|inactive customer)\b/i.test(message)) {
    const { data: topCustomers } = await supabaseAdmin
      .from('customer_profile_summary')
      .select('customer_id, customer_name, customer_phone, lifetime_bookings, last_visit, favorite_service, favorite_staff, days_since_visit, risk_score')
      .eq('tenant_id', tenantId)
      .order('lifetime_bookings', { ascending: false })
      .limit(5);
    summary.top_customers = topCustomers ?? [];
  }

  if (/\b(prefer|preference|favorite service|what does .* book|books .* frequently|customer service history)\b/i.test(message)) {
    const { data: customerServiceHistory } = await supabaseAdmin
      .from('customer_service_history_view')
      .select('customer_id, customer_name, customer_phone, service_id, service_name, booking_count, completed_count, estimated_revenue, last_completed_at')
      .eq('tenant_id', tenantId)
      .order('booking_count', { ascending: false })
      .limit(10);
    summary.customer_service_history = customerServiceHistory ?? [];
  }

  if (/\b(loyal|loyalty|always book|always books|customer staff history|staff customer history|which customers book|which stylist)\b/i.test(message)) {
    const { data: staffCustomerHistory } = await supabaseAdmin
      .from('staff_customer_history_view')
      .select('staff_id, staff_name, customer_id, customer_name, customer_phone, booking_count, completed_count, last_completed_at')
      .eq('tenant_id', tenantId)
      .order('booking_count', { ascending: false })
      .limit(10);
    summary.staff_customer_history = staffCustomerHistory ?? [];
  }

  if (/\b(follow[ -]?up|re-engage|reengage|win back|come back|stopped coming|inactive customer|at risk|lapsed)\b/i.test(message)) {
    const { data: followupCandidates } = await supabaseAdmin
      .from('followup_candidates_view')
      .select('customer_id, customer_name, customer_phone, lifetime_bookings, favorite_service, favorite_staff, days_since_visit, risk_score, next_booking_at, is_followup_candidate, candidate_reason')
      .eq('tenant_id', tenantId)
      .eq('is_followup_candidate', true)
      .order('days_since_visit', { ascending: false })
      .limit(20);
    summary.followup_candidates = followupCandidates ?? [];
  }

  if (/\b(top service|best service|service performs|popular service)\b/i.test(message)) {
    const { data: topServices } = await supabaseAdmin
      .from('service_performance_summary')
      .select('service_id, bookings, revenue, cancellations, completion_rate')
      .eq('tenant_id', tenantId)
      .order('bookings', { ascending: false })
      .limit(5);
    summary.top_services = topServices ?? [];
  }

  if (/\b(best stylist|best staff|top staff|top stylist|best barber|best nail tech)\b/i.test(message)) {
    const { data: topStaff } = await supabaseAdmin
      .from('staff_performance_summary')
      .select('staff_id, bookings, completion_rate, estimated_revenue')
      .eq('tenant_id', tenantId)
      .order('bookings', { ascending: false })
      .limit(5);
    summary.top_staff = topStaff ?? [];
  }

  if (/\b(revenue|earning|sales|worth|highest value|most revenue)\b/i.test(message)) {
    let revenueQuery = supabaseAdmin
      .from('tenant_revenue_view')
      .select('booking_date, service_id, service_name, staff_id, staff_name, customer_id, customer_name, customer_phone, booking_count, completed_count, estimated_revenue')
      .eq('tenant_id', tenantId)
      .gte('booking_date', dateRange.start)
      .lte('booking_date', dateRange.end)
      .order('booking_date', { ascending: false })
      .limit(20);

    if (/\b(service\b|services\b)/.test(normalized)) {
      revenueQuery = revenueQuery.order('estimated_revenue', { ascending: false });
    }

    const { data: revenueRows } = await revenueQuery;
    summary.revenue_breakdown = revenueRows ?? [];
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

async function getAvailabilitySnapshot(
  tenantId: string,
  message: string,
  intent: FrontDeskIntent,
  conv: ConvState,
  services: ServiceContext[],
  staff: StaffContext[]
): Promise<Array<{ staffId: string; slots: string[] }>> {
  if (!['booking_request', 'availability_question', 'reschedule_booking'].includes(intent)) {
    return [];
  }

  const targetDate = resolveDate(message);
  const serviceId = resolveServiceId(message, conv, services);
  const snapshot = await getPrecomputedAvailability(tenantId, targetDate, serviceId);
  if ((intent === 'availability_question' || intent === 'booking_request') && snapshot.length > 0) {
    return snapshot;
  }
  if (!serviceId) return snapshot;

  const staffToCheck = staff.slice(0, 3);

  const slotLists = await Promise.all(
    staffToCheck.map(async (staffMember) => {
      const slots = await getAvailableSlots(tenantId, staffMember.id, targetDate, serviceId);
      return {
        staffId: staffMember.id,
        slots: slots.filter((slot) => slot.available).map((slot) => slot.start).slice(0, 6),
      };
    })
  );

  return slotLists.filter((entry) => entry.slots.length > 0);
}

async function getPrecomputedAvailability(
  tenantId: string,
  date: string,
  serviceId?: string | null
): Promise<Array<{ staffId: string; slots: string[] }>> {
  let query = supabaseAdmin
    .from('availability_snapshot')
    .select('staff_id, available_slots')
    .eq('tenant_id', tenantId)
    .eq('date', date)
    .limit(6);

  if (serviceId) {
    query = query.eq('service_id', serviceId);
  }

  const { data } = await query;

  return (data ?? []).map((row) => ({
    staffId: String(row.staff_id),
    slots: Array.isArray(row.available_slots) ? row.available_slots.map(String).slice(0, 6) : [],
  })).filter((entry) => entry.slots.length > 0);
}

function resolveServiceId(
  message: string,
  conv: ConvState,
  services: ServiceContext[]
): string | null {
  const inProgress = conv.flow_data?.booking_in_progress as { service_id?: string } | undefined;
  if (inProgress?.service_id) return inProgress.service_id;

  const normalized = message.toLowerCase();
  const match = services.find((service) => normalized.includes(service.name.toLowerCase()));
  return match?.id ?? services[0]?.id ?? null;
}

function resolveDate(message: string): string {
  return resolveDateRange(message).start;
}

function resolveDateRange(message: string): { start: string; end: string; label: string } {
  const now = new Date();
  const normalized = message.toLowerCase();

  const explicitRange = extractExplicitRange(normalized, now);
  if (explicitRange) {
    return explicitRange;
  }

  const explicitDate = extractExplicitDate(normalized);
  if (explicitDate) {
    return { start: explicitDate, end: explicitDate, label: 'explicit_date' };
  }

  if (/\byesterday\b/i.test(normalized)) {
    const date = addDays(now, -1);
    return { start: isoDate(date), end: isoDate(date), label: 'yesterday' };
  }

  if (/\btomorrow\b/i.test(normalized)) {
    const date = addDays(now, 1);
    return { start: isoDate(date), end: isoDate(date), label: 'tomorrow' };
  }

  if (/\bnext week\b/i.test(normalized)) {
    const start = startOfWeek(addDays(now, 7));
    const end = addDays(start, 6);
    return { start: isoDate(start), end: isoDate(end), label: 'next_week' };
  }

  if (/\bthis week\b/i.test(normalized)) {
    const start = startOfWeek(now);
    const end = addDays(start, 6);
    return { start: isoDate(start), end: isoDate(end), label: 'this_week' };
  }

  if (/\bnext month\b/i.test(normalized)) {
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { start: isoDate(start), end: isoDate(end), label: 'next_month' };
  }

  if (/\bthis month\b/i.test(normalized)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: isoDate(start), end: isoDate(end), label: 'this_month' };
  }

  const weekdayDate = extractWeekdayDate(normalized, now);
  if (weekdayDate) {
    return { start: isoDate(weekdayDate), end: isoDate(weekdayDate), label: 'weekday' };
  }

  const today = isoDate(now);
  return { start: today, end: today, label: 'today' };
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function extractExplicitDate(message: string): string | null {
  const isoMatch = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = message.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (!slashMatch) return null;

  const day = slashMatch[1].padStart(2, '0');
  const month = slashMatch[2].padStart(2, '0');
  const year = slashMatch[3];
  return `${year}-${month}-${day}`;
}

function extractExplicitRange(
  message: string,
  now: Date
): { start: string; end: string; label: string } | null {
  const tokenPattern = [
    'today',
    'tomorrow',
    'yesterday',
    'next\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    '20\\d{2}-\\d{2}-\\d{2}',
    '\\d{1,2}[/-]\\d{1,2}[/-]20\\d{2}',
  ].join('|');

  const rangeRegex = new RegExp(
    `\\b(?:from|between)\\s+(${tokenPattern})\\s+(?:to|and)\\s+(${tokenPattern})\\b`,
    'i'
  );

  const match = message.match(rangeRegex);
  if (!match) return null;

  const start = parseDateToken(match[1], now);
  const end = parseDateToken(match[2], now);
  if (!start || !end) return null;

  return start <= end
    ? { start, end, label: 'explicit_range' }
    : { start: end, end: start, label: 'explicit_range' };
}

function parseDateToken(token: string, now: Date): string | null {
  const normalized = token.trim().toLowerCase();

  if (normalized === 'today') return isoDate(now);
  if (normalized === 'tomorrow') return isoDate(addDays(now, 1));
  if (normalized === 'yesterday') return isoDate(addDays(now, -1));

  const explicitDate = extractExplicitDate(normalized);
  if (explicitDate) return explicitDate;

  const weekdayDate = extractWeekdayDate(normalized, now);
  if (weekdayDate) return isoDate(weekdayDate);

  return null;
}

function extractWeekdayDate(message: string, now: Date): Date | null {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const match = message.match(/\b(?:(next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (!match) return null;

  const isNext = match[1] === 'next';
  const weekday = weekdays.indexOf(match[2]);
  if (weekday < 0) return null;

  const date = new Date(now);
  const todayWeekday = date.getDay();
  let delta = weekday - todayWeekday;

  if (delta < 0 || (delta === 0 && isNext)) {
    delta += 7;
  }

  date.setDate(date.getDate() + delta);
  return date;
}
