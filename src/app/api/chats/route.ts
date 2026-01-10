import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

type ChatRow = {
  id: string;
  customer_phone?: string | null;
  metadata?: { subject?: string } | null;
  last_message_at?: string | null;
};

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const tenantId = searchParams.get('tenant_id') || ctx.user?.tenantId;

    console.log('[Chats API] GET request:', {
      queryTenantId: searchParams.get('tenant_id'),
      ctxTenantId: ctx.user?.tenantId,
      resolvedTenantId: tenantId,
    });

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id is required');
    }

    const { data, error } = await ctx.supabase
      .from('chats')
      .select('id,customer_phone,metadata,last_message_at')
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[Chats API] Supabase error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch chats: ' + error.message));
    }

    const mapped = ((data || []) as ChatRow[]).map((c) => ({
      id: c.id,
      subject: c.metadata?.subject || c.customer_phone || String(c.id).slice(0, 6),
      last_message_at: c.last_message_at,
      unread: 0, // Default value since unread_count column doesn't exist
    }));

    return mapped;
  },
  'GET'
);

export const POST = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const tenantId = searchParams.get('tenant_id') || ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id is required');
    }

    const body = await ctx.request.json();

    const payload = {
      tenant_id: tenantId,
      customer_phone: body.phone || body.customer_phone || null,
      metadata: body.metadata || null,
      last_message_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from('chats')
      .insert([payload])
      .select('*')
      .maybeSingle();

    if (error) {
      throw ApiErrorFactory.internalServerError(new Error('Failed to create chat'));
    }

    return data;
  },
  'POST'
);
