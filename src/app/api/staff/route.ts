export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const StaffSeedSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(['manager', 'staff']).optional(),
});

/**
 * GET /api/staff
 * Fetch staff members for a tenant
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .select('user_id,role,email,name')
      .eq('tenant_id', tenantId)
      .neq('role', 'owner')
      .order('role', { ascending: true });

    if (error) throw ApiErrorFactory.databaseError(error);

    const staff = (data || []).map((row: Record<string, unknown>) => ({
      id: row.user_id,
      name: row.name || row.email || row.user_id,
      email: row.email,
      role: row.role,
      status: 'active',
      staff_type: null
    }));

    return { staff };
  },
  'GET',
  { auth: true, permissions: [BOOKA_PERMISSIONS.MANAGE_STAFF] }
);

/**
 * POST /api/staff
 * Seed placeholder staff members for a tenant (used during onboarding).
 * Creates tenant_users rows without a linked auth user account; the staff
 * member will claim the row when they sign up via the invite link.
 *
 * Body: Array of { name?, email?, role? }
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);

    const raw = await parseJsonBody(ctx.request);
    const parsed = z.array(StaffSeedSchema).safeParse(raw);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }
    const members = parsed.data;

    if (members.length === 0) return { success: true, count: 0 };

    const existingResult = await createSupabaseAdminClient()
      .from('tenant_users')
      .select('email, phone, role')
      .eq('tenant_id', tenantId);
    if (existingResult.error) {
      throw ApiErrorFactory.databaseError(existingResult.error);
    }

    const existingRows = (existingResult.data || []) as Record<string, unknown>[];
    const existingEmails = new Set(
      existingRows
        .map((row) => typeof row.email === 'string' ? row.email.trim().toLowerCase() : null)
        .filter((value): value is string => Boolean(value))
    );
    const existingPhones = new Set(
      existingRows
        .map((row) => typeof row.phone === 'string' ? row.phone.trim() : null)
        .filter((value): value is string => Boolean(value))
    );
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    const rows = members
      .map((m) => {
        const email = m.email?.trim().toLowerCase() || null;
        const phone = m.phone?.trim() || null;
        const name = m.name?.trim() || null;
        const role = m.role ?? 'staff';

        if (!email && !phone && !name) return null;
        if (email && (existingEmails.has(email) || seenEmails.has(email))) return null;
        if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) return null;

        if (email) seenEmails.add(email);
        if (phone) seenPhones.add(phone);

        return {
          tenant_id: tenantId,
          name,
          email,
          phone,
          role,
        };
      })
      .filter((row): row is {
        tenant_id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        role: 'manager' | 'staff';
      } => Boolean(row));

    if (rows.length === 0) return { success: true, count: 0 };

    // This onboarding seed path creates placeholder tenant_users rows before the
    // invited staff claim an auth account. Use the admin client after auth/tenant
    // ownership has already been verified by the route wrapper so we do not rely
    // on RLS behavior for partially populated placeholder rows.
    const { error } = await createSupabaseAdminClient().from('tenant_users').insert(rows);
    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true, count: rows.length };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'], permissions: [BOOKA_PERMISSIONS.MANAGE_STAFF] }
);
