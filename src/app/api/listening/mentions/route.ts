export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const VALID = ['new', 'engaged', 'dismissed', 'converted'];

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('No tenant in context');
    }

    const raw = new URL(ctx.request.url).searchParams.get('status');
    const status = VALID.includes(raw ?? '') ? raw : undefined;

    const admin = createSupabaseAdminClient();
    let query = admin.from('social_mentions').select('*').eq('tenant_id', tenantId);
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) {
      throw error;
    }

    return { success: true, mentions: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
