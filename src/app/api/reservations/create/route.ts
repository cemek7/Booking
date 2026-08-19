export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

/**
 * POST /api/reservations/create
 *
 * Human-friendly reservation creation used by ReservationForm (the "book a
 * customer" flow). Unlike POST /api/reservations (which takes resolved UUIDs),
 * this accepts a name/phone/service-text/duration payload, then:
 *   - finds or creates the customer by phone within the tenant
 *   - maps the service name to a service_id when one matches
 *   - computes end_at from the duration
 *
 * Returns { id } of the new reservation.
 */
const CreateSchema = z.object({
  customer_name: z.string().min(1),
  phone: z.string().min(3),
  service: z.string().trim().optional().default(''),
  start_at: z.string().min(1),
  duration_minutes: z.number().int().positive().max(24 * 60).optional().default(60),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const raw = await parseJsonBody<unknown>(ctx.request);
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }
    const { customer_name, phone, service, start_at, duration_minutes } = parsed.data;

    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const start = new Date(start_at);
    if (Number.isNaN(start.getTime())) {
      throw ApiErrorFactory.validationError({ start_at: 'Invalid date/time' });
    }
    const end = new Date(start.getTime() + duration_minutes * 60_000);

    // 1) Find-or-create the customer by phone within the tenant.
    let customerId: string | null = null;
    const { data: existingCustomer } = await ctx.supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(`phone.eq.${phone},phone_number.eq.${phone}`)
      .limit(1)
      .maybeSingle();

    if (existingCustomer?.id) {
      customerId = existingCustomer.id as string;
    } else {
      const { data: created, error: custErr } = await ctx.supabase
        .from('customers')
        .insert([{ tenant_id: tenantId, name: customer_name, customer_name, phone, phone_number: phone }])
        .select('id')
        .maybeSingle();
      if (custErr) throw ApiErrorFactory.databaseError(custErr);
      customerId = created?.id ?? null;
    }

    // 2) Map the service name to a service_id when it matches one for the tenant.
    let serviceId: string | null = null;
    if (service) {
      const { data: svc } = await ctx.supabase
        .from('services')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('name', service)
        .limit(1)
        .maybeSingle();
      serviceId = svc?.id ?? null;
    }

    // 3) Insert the reservation.
    const { data: reservation, error: resErr } = await ctx.supabase
      .from('reservations')
      .insert([{
        tenant_id: tenantId,
        customer_id: customerId,
        customer_number: phone,
        service_id: serviceId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        duration: duration_minutes,
        status: 'pending',
        metadata: { customer_name, service_name: service || null, source: 'reservation_form' },
      }])
      .select('id')
      .maybeSingle();

    if (resErr) throw ApiErrorFactory.databaseError(resErr);

    return { id: reservation?.id, success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
