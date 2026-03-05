import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const StaffSeedSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['owner', 'manager', 'staff']).optional(),
});

/**
 * GET /api/staff
 * Fetch staff members for a tenant
 *
 * Query params:
 * - tenant_id: Tenant ID (optional, uses ctx.user.tenantId if not provided)
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const tenantId = url.searchParams.get('tenant_id') || ctx.user!.tenantId;

    const { data, error } = await ctx.supabase
      .from('tenant_users')
      .select('user_id,role,email,name')
      .eq('tenant_id', tenantId)
      .neq('role', 'owner')
      .order('role', { ascending: true });

    if (error) throw ApiErrorFactory.databaseError(error);

    const staff = (data || []).map((row: any) => ({
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
  { auth: true }
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
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const raw = await parseJsonBody(ctx.request);
    const members = z.array(StaffSeedSchema).parse(raw);

    if (members.length === 0) return { success: true, count: 0 };

    const rows = members.map((m) => ({
      tenant_id: tenantId,
      name: m.name ?? null,
      email: m.email ?? null,
      role: m.role ?? 'staff',
      status: 'active',
    }));

    const { error } = await ctx.supabase.from('tenant_users').insert(rows);
    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true, count: rows.length };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
