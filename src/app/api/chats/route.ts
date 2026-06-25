export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { defaultLogger } from '@/lib/logger';

type ChatRow = {
  id: string;
  customer_phone?: string | null;
  metadata?: { subject?: string; channel?: 'whatsapp' | 'instagram' } | null;
  last_message_at?: string | null;
  unread_count?: number | null;
};

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;

    defaultLogger.debug('[Chats API] GET request', {
      resolvedTenantId: tenantId,
    });

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id is required');
    }

    const { data, error } = await ctx.supabase
      .from('chats')
      .select('id,customer_phone,metadata,last_message_at,unread_count')
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(100);

    if (error) {
      defaultLogger.error('[Chats API] Supabase error:', error);
      throw ApiErrorFactory.internalServerError(new Error('Failed to fetch chats: ' + error.message));
    }

    const mapped = ((data || []) as ChatRow[]).map((c) => ({
      id: c.id,
      subject: c.metadata?.subject || c.customer_phone || String(c.id).slice(0, 6),
      last_message_at: c.last_message_at,
      unread: c.unread_count ?? 0,
      channel: c.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp',
    }));

    return mapped;
  },
  'GET',
  { auth: true }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;

    if (!tenantId) {
      throw ApiErrorFactory.badRequest('tenant_id is required');
    }

    const body = await ctx.request.json();

    const payload = {
      tenant_id: tenantId,
      customer_phone: body.phone || body.customer_phone || null,
      metadata: {
        ...(body.metadata || {}),
        channel: body.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp',
      },
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
  'POST',
  { auth: true }
);
