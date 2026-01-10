import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { isGlobalAdmin } from '@/types/unified-permissions';

/**
 * GET /api/admin/metrics
 * 
 * Admin-only endpoint for aggregated metrics. Retrieves token usage and call count
 * per tenant for the last 30 days. Only global admins can access.
 */

export const GET = createHttpHandler(
  async (ctx) => {
    // Verify global admin permission
    const ok = await isGlobalAdmin(ctx.supabase, ctx.user!.id, ctx.user!.email);
    if (!ok) throw ApiErrorFactory.insufficientPermissions(['admin']);

    // Query metrics: token usage and call count per tenant for last 30 days
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await ctx.supabase
      .from('llm_calls')
      .select('tenant_id, total_tokens, created_at')
      .gte('created_at', since);

    if (error) throw ApiErrorFactory.internal('Failed to fetch metrics');

    // Aggregate by tenant
    const byTenant: Record<string, { tenant_id: string; total_tokens: number; call_count: number }> = {};

    for (const r of rows || []) {
      const t = r.tenant_id || 'unknown';
      if (!byTenant[t]) {
        byTenant[t] = { tenant_id: t, total_tokens: 0, call_count: 0 };
      }
      byTenant[t].total_tokens += r.total_tokens || 0;
      byTenant[t].call_count += 1;
    }

    return { metrics: Object.values(byTenant) };
  },
  'GET',
  { auth: true, roles: ['admin'] }
);
          byTenant[t].call_count += 1;
          byTenant[t].total_tokens += r.total_tokens || 0;
        }

        data = Object.values(byTenant);
      }
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: unknown) {
    console.warn('[api/admin/metrics] error', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
