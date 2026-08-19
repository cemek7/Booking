export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { enqueueJob } from '@/lib/webhooks';
import { getTenantIdByInstanceName } from '@/lib/whatsapp/providers';
import { whatsappMediaHandler } from '@/lib/whatsapp/mediaHandler';
import { trace, Span } from '@opentelemetry/api';
import { defaultLogger } from '@/lib/logger';

// ─── Payload type guards ───────────────────────────────────────────────────

interface EvolutionPayload {
  instance?: string;
  event?: string;
  data?: {
    key?: { id?: string; fromMe?: boolean; remoteJid?: string };
    message?: Record<string, unknown>;
    messageTimestamp?: number;
    qrcode?: { base64?: string; code?: string };
    state?: string;
    wuid?: string;
    instance?: { ownerJid?: string };
  };
}

function isWahaPayload(raw: unknown): boolean {
  return !!(raw && typeof raw === 'object' && 'session' in raw);
}

// ─── Shared entry point ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const tracer = trace.getTracer('boka-webhook');
  const span = tracer.startSpan('webhook.whatsapp');

  try {
    const rawBody = await request.text();
    const raw = JSON.parse(rawBody);
    const supabase = createSupabaseAdminClient();

    // 1. Secret validation (same header for both providers)
    const evolutionSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!evolutionSecret) {
      defaultLogger.error('[WEBHOOK] EVOLUTION_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const incomingSecret = request.headers.get('x-evolution-secret') ?? '';
    const expected = Buffer.from(evolutionSecret);
    const incoming = Buffer.from(incomingSecret);
    const secretValid =
      incoming.length === expected.length && timingSafeEqual(expected, incoming);
    if (!secretValid) {
      defaultLogger.warn('[WEBHOOK] Secret mismatch — request rejected');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isWahaPayload(raw)) {
      return NextResponse.json(
        { error: 'wrong_endpoint_for_waha', message: 'Use /api/webhooks/whatsapp/:tenantId for WAHA webhooks.' },
        { status: 400 }
      );
    }
    return handleEvolution(raw as EvolutionPayload, supabase, span);
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Unhandled error:', e);
    span.end();
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    span.end();
  }
}

// ─── Evolution handler ─────────────────────────────────────────────────────

async function handleEvolution(
  payload: EvolutionPayload,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  span: Span
): Promise<NextResponse> {
  const instance = payload?.instance;
  const event = payload?.event ?? '';
  const isConnectionEvent = event === 'qrcode.updated' || event === 'connection.update';

  if (payload?.data?.key?.fromMe) {
    return NextResponse.json({ status: 'skipped_own_message' }, { status: 200 });
  }
  if (!instance) {
    return NextResponse.json({ error: 'Missing instance name in payload' }, { status: 400 });
  }

  if (!isConnectionEvent && !payload?.data?.key?.id) {
    defaultLogger.warn('[WEBHOOK-EVO] Missing message key.id');
    return NextResponse.json({ error: 'Invalid payload: missing data.key.id' }, { status: 400 });
  }

  const tenantId = await getTenantIdByInstanceName(instance);
  if (!tenantId) {
    defaultLogger.warn(`[WEBHOOK-EVO] Unknown instance: ${instance}`);
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  span.setAttribute('tenant.id', tenantId);

  if (event === 'qrcode.updated') {
    const qrCode = payload?.data?.qrcode?.base64 || payload?.data?.qrcode?.code || null;
    if (qrCode) {
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connecting', qr_code: qrCode, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
    }
    return NextResponse.json({ status: 'qr_stored' }, { status: 200 });
  }

  if (event === 'connection.update') {
    const state = payload?.data?.state;
    if (state === 'open') {
      const phone =
        payload?.data?.wuid?.split('@')[0] ||
        payload?.data?.instance?.ownerJid?.split('@')[0] ||
        null;
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connected', phone_number: phone, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
    } else if (state === 'close') {
      await supabase
        .from('whatsapp_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('instance_name', instance);
    }
    return NextResponse.json({ status: 'connection_updated', state }, { status: 200 });
  }

  const messageId = payload.data?.key?.id;
  if (!messageId) {
    defaultLogger.warn('[WEBHOOK-EVO] Missing message key.id after validation');
    return NextResponse.json({ error: 'Invalid payload: missing data.key.id' }, { status: 400 });
  }
  const isDuplicate = await handleIdempotency(supabase, 'evolution', instance, messageId, payload, span);
  if (isDuplicate) return NextResponse.json({ status: 'duplicate', replay: true }, { status: 200 });

  const parsedMessage = parseEvolutionMessage(payload, tenantId);
  if (!parsedMessage) {
    return NextResponse.json({ error: 'Could not parse message' }, { status: 400 });
  }

  const chatId = await upsertChat(supabase, tenantId, parsedMessage.from_number as string);
  if (chatId) parsedMessage.chat_id = chatId;

  const messageRowId = await persistMessage(supabase, parsedMessage);
  if (!messageRowId) {
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
  span.setAttribute('message.id', messageRowId);

  if (parsedMessage.media_info) {
    await processMedia(supabase, tenantId, parsedMessage, messageRowId);
  }

  return routeMessage(
    supabase,
    tenantId,
    instance,
    parsedMessage.from_number as string,
    parsedMessage.content as string,
    messageRowId
  );
}

// ─── Shared helpers ────────────────────────────────────────────────────────

async function routeMessage(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  instance: string,
  fromNumber: string,
  content: string,
  messageRowId: string
): Promise<NextResponse> {
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('v2_enabled')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantRow?.v2_enabled) {
    const { appendPendingMessage } = await import('@/lib/whatsapp/v2/messageBatcher');
    const { resolveIncoming } = await import('@/lib/whatsapp/v2/identityResolver');
    const { ensureConversation } = await import('@/lib/whatsapp/v2/conversationState');

    const identity = await resolveIncoming('whatsapp', fromNumber, content);
    const resolvedTenantId = identity.tenantId ?? tenantId;
    const role = identity.role;

    await ensureConversation(fromNumber, resolvedTenantId, role);
    await appendPendingMessage(fromNumber, resolvedTenantId, identity.strippedMessage || content, messageRowId);

    await supabase.from('whatsapp_message_queue').insert({
      tenant_id: resolvedTenantId,
      message_id: messageRowId,
      from_number: fromNumber,
      to_number: instance,
      content: identity.strippedMessage || content,
      status: 'pending',
      priority: 'normal',
    });

    if (process.env.NODE_ENV !== 'production') {
      const workerBase = process.env.APP_URL || 'http://localhost:3000';
      fetch(`${workerBase}/api/worker/whatsapp`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET || 'dev-cron-secret'}` },
      }).catch(() => {});
    }

    return NextResponse.json({ status: 'accepted_v2', messageId: messageRowId }, { status: 202 });
  }

  await enqueueJob(supabase, 'process_whatsapp_message', {
    message_id: messageRowId,
    tenant_id: tenantId,
  });

  return NextResponse.json({ status: 'accepted', messageId: messageRowId }, { status: 202 });
}

async function handleIdempotency(
  supabase: SupabaseClient,
  provider: 'evolution' | 'waha' | 'meta',
  instanceScope: string,
  messageId: string,
  payload: unknown,
  span: Span
): Promise<boolean> {
  try {
    const externalId = `${instanceScope}:${messageId}`;
    const { error } = await supabase.from('webhook_events').insert({
      provider,
      external_id: externalId,
      payload,
      processed_at: new Date().toISOString(),
    });
    if (error?.code === '23505') {
      span.setAttribute('webhook.is_duplicate', true);
      return true;
    }
    if (error) throw error;
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Idempotency check error:', e);
  }
  span.setAttribute('webhook.is_duplicate', false);
  return false;
}

function parseEvolutionMessage(
  payload: EvolutionPayload,
  tenantId: string
): Record<string, unknown> | null {
  const { instance, data } = payload;
  const { key, message, messageTimestamp } = data || {};
  if (!key || !message) return null;

  const remoteJid = key.remoteJid;
  const phoneNumber = remoteJid?.replace(/@s\.whatsapp\.net|@c\.us/g, '');

  let messageContent = '';
  let messageType = 'unknown';
  let mediaInfo = null;

  if (message.conversation) {
    messageContent = message.conversation as string;
    messageType = 'text';
  } else if ((message.extendedTextMessage as Record<string, unknown>)?.text) {
    messageContent = (message.extendedTextMessage as Record<string, unknown>).text as string;
    messageType = 'text';
  } else if (message.imageMessage) {
    const img = message.imageMessage as Record<string, unknown>;
    messageContent = (img.caption as string) || '';
    messageType = 'image';
    mediaInfo = { url: img.url, mimeType: img.mimetype, caption: img.caption, fileName: img.fileName };
  } else if (message.videoMessage) {
    const vid = message.videoMessage as Record<string, unknown>;
    messageContent = (vid.caption as string) || '';
    messageType = 'video';
    mediaInfo = { url: vid.url, mimeType: vid.mimetype, caption: vid.caption };
  } else if (message.documentMessage) {
    const doc = message.documentMessage as Record<string, unknown>;
    messageContent = (doc.title as string) || (doc.fileName as string) || 'Document';
    messageType = 'document';
    mediaInfo = { url: doc.url, mimeType: doc.mimetype, title: doc.title, fileName: doc.fileName };
  } else if (message.audioMessage) {
    const aud = message.audioMessage as Record<string, unknown>;
    messageContent = '[Audio]';
    messageType = 'audio';
    mediaInfo = { url: aud.url, mimeType: aud.mimetype };
  } else if ((message.templateButtonReplyMessage as Record<string, unknown>)?.selectedDisplayText) {
    messageContent = ((message.templateButtonReplyMessage as Record<string, unknown>).selectedDisplayText as string);
    messageType = 'button_reply';
  } else if ((message.listResponseMessage as Record<string, unknown>)?.title) {
    messageContent = ((message.listResponseMessage as Record<string, unknown>).title as string);
    messageType = 'list_reply';
  }

  return {
    tenant_id: tenantId,
    from_number: phoneNumber,
    to_number: instance,
    content: messageContent,
    direction: 'inbound',
    message_type: messageType,
    raw: payload,
    media_info: mediaInfo,
    evolution_message_id: key.id,
    timestamp: new Date((messageTimestamp ?? 0) * 1000).toISOString(),
  };
}

async function persistMessage(
  supabase: SupabaseClient,
  message: Record<string, unknown>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert(message)
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Failed to persist message:', e);
    return null;
  }
}

async function upsertChat(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  phone: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('chats')
    .upsert(
      { tenant_id: tenantId, customer_phone: phone, last_message_at: new Date().toISOString() },
      { onConflict: 'tenant_id,customer_phone' }
    )
    .select('id')
    .single();
  if (error) {
    defaultLogger.error('[WEBHOOK] Failed to upsert chat:', error);
    return null;
  }
  return data.id;
}

async function processMedia(
  supabase: SupabaseClient,
  tenantId: string,
  message: Record<string, unknown>,
  messageRowId: string
) {
  try {
    const phoneNumber = typeof message.from_number === 'string' ? message.from_number : null;
    const messageId = typeof message.evolution_message_id === 'string' ? message.evolution_message_id : undefined;
    const messageType = typeof message.message_type === 'string' && ['image', 'audio', 'video', 'document', 'sticker'].includes(message.message_type)
      ? message.message_type as 'image' | 'audio' | 'video' | 'document' | 'sticker'
      : null;
    if (!phoneNumber || !messageType) {
      defaultLogger.warn('[WEBHOOK] Skipping malformed media message');
      return;
    }
    const mediaResult = await whatsappMediaHandler.processIncomingMedia(
      tenantId,
      phoneNumber,
      {
        id: messageId,
        type: messageType,
        ...(message.media_info as object),
      }
    );

    if (mediaResult.success && mediaResult.url) {
      await supabase
        .from('messages')
        .update({ media_url: mediaResult.url })
        .eq('id', messageRowId);
    }
  } catch (e) {
    defaultLogger.error('[WEBHOOK] Media processing error:', e);
  }
}
