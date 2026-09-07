export const dynamic = 'force-dynamic';

import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { trace, Span } from '@opentelemetry/api';
import { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { enqueueJob } from '@/lib/webhooks';
import { whatsappMediaHandler } from '@/lib/whatsapp/mediaHandler';
import { defaultLogger } from '@/lib/logger';

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

interface WahaPayload {
  session?: string;
  event?: string;
  payload?: {
    id?: { _serialized?: string; fromMe?: boolean };
    from?: string;
    body?: string;
    timestamp?: number;
    type?: string;
    mediaUrl?: string;
    caption?: string;
    status?: string;
    qr?: { value?: string };
    me?: { id?: string };
  };
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          video?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
          audio?: { id?: string; mime_type?: string };
          interactive?: {
            type?: 'button_reply' | 'list_reply';
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
        }>;
      };
    }>;
  }>;
}

interface MetaIncomingMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  audio?: { id?: string; mime_type?: string };
  interactive?: {
    type?: 'button_reply' | 'list_reply';
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

function isEvolutionPayload(raw: unknown): raw is EvolutionPayload {
  return !!(raw && typeof raw === 'object' && 'instance' in raw);
}

function isWahaPayload(raw: unknown): raw is WahaPayload {
  return !!(raw && typeof raw === 'object' && 'session' in raw);
}

function isMetaPayload(raw: unknown): raw is MetaWebhookPayload {
  return !!(raw && typeof raw === 'object' && 'object' in raw && 'entry' in raw);
}

function verifySharedSecret(rawSecret: string, incomingSecret: string): boolean {
  if (!rawSecret || !incomingSecret) return false;
  const expected = Buffer.from(rawSecret);
  const incoming = Buffer.from(incomingSecret);
  return expected.length === incoming.length && timingSafeEqual(expected, incoming);
}

function verifyMetaSignature(rawBody: string, incomingSignature: string | null, appSecret: string): boolean {
  if (!incomingSignature?.startsWith('sha256=') || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const incomingBuffer = Buffer.from(incomingSignature);
  return expectedBuffer.length === incomingBuffer.length && timingSafeEqual(expectedBuffer, incomingBuffer);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> | { tenantId: string } }
) {
  const tracer = trace.getTracer('boka-webhook');
  const span = tracer.startSpan('webhook.whatsapp.tenant');

  try {
    const params = await Promise.resolve(context.params);
    const tenantId = params?.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'missing_tenant_id' }, { status: 400 });
    }

    const rawBody = await request.text();
    const raw = JSON.parse(rawBody) as unknown;
    const supabase = createSupabaseAdminClient();

    const { data: config, error: configError } = await supabase
      .from('whatsapp_configurations')
      .select('tenant_id, provider, instance_name, meta_phone_number_id, active')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .maybeSingle();

    if (configError) {
      defaultLogger.error('[WEBHOOK-TENANT] Failed to load tenant config', configError);
      return NextResponse.json({ error: 'config_lookup_failed' }, { status: 500 });
    }
    if (!config) {
      return NextResponse.json({ error: 'tenant_whatsapp_not_configured' }, { status: 404 });
    }

    const provider = (config.provider as 'evolution' | 'waha' | 'meta' | undefined) ?? 'evolution';
    span.setAttribute('tenant.id', tenantId);
    span.setAttribute('whatsapp.provider', provider);

    if (provider === 'meta') {
      const appSecret = process.env.WHATSAPP_APP_SECRET || '';
      if (!appSecret) {
        defaultLogger.error('[WEBHOOK-TENANT] WHATSAPP_APP_SECRET not configured');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
      }

      const incomingSignature = request.headers.get('x-hub-signature-256');
      if (!verifyMetaSignature(rawBody, incomingSignature, appSecret)) {
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
      }
      if (!isMetaPayload(raw)) {
        return NextResponse.json({ error: 'invalid_meta_payload' }, { status: 400 });
      }
      return handleMeta(raw, supabase, span, tenantId, config.meta_phone_number_id ?? config.instance_name ?? '');
    }

    const evolutionSecret = process.env.EVOLUTION_WEBHOOK_SECRET || '';
    if (!evolutionSecret) {
      defaultLogger.error('[WEBHOOK-TENANT] EVOLUTION_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const incomingSecret = request.headers.get('x-evolution-secret') ?? '';
    if (!verifySharedSecret(evolutionSecret, incomingSecret)) {
      defaultLogger.warn('[WEBHOOK-TENANT] Secret mismatch - request rejected');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (provider === 'waha') {
      if (!isWahaPayload(raw)) {
        return NextResponse.json({ error: 'invalid_waha_payload' }, { status: 400 });
      }
      return handleWaha(raw, supabase, span, tenantId, config.instance_name ?? 'default');
    }

    if (!isEvolutionPayload(raw)) {
      return NextResponse.json({ error: 'invalid_evolution_payload' }, { status: 400 });
    }
    return handleEvolution(raw, supabase, span, tenantId, config.instance_name ?? '');
  } catch (e) {
    defaultLogger.error('[WEBHOOK-TENANT] Unhandled error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    span.end();
  }
}

async function handleEvolution(
  raw: EvolutionPayload,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  span: Span,
  tenantId: string,
  expectedInstance: string
): Promise<NextResponse> {
  const instance = raw.instance ?? '';
  const event = raw.event ?? '';

  if (raw.data?.key?.fromMe) {
    return NextResponse.json({ status: 'skipped_own_message' }, { status: 200 });
  }
  if (!instance) {
    return NextResponse.json({ error: 'Missing instance name in payload' }, { status: 400 });
  }
  if (expectedInstance && instance !== expectedInstance) {
    return NextResponse.json({ error: 'instance_mismatch_for_tenant' }, { status: 409 });
  }

  if (event === 'qrcode.updated') {
    const qrCode = raw.data?.qrcode?.base64 || raw.data?.qrcode?.code || null;
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
    const state = raw.data?.state;
    if (state === 'open') {
      const phone =
        raw.data?.wuid?.split('@')[0] ||
        raw.data?.instance?.ownerJid?.split('@')[0] ||
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

  const messageId = raw.data?.key?.id;
  if (!messageId) {
    return NextResponse.json({ error: 'Invalid payload: missing data.key.id' }, { status: 400 });
  }

  const isDuplicate = await handleIdempotency(
    supabase,
    'evolution',
    `${tenantId}:${instance}`,
    messageId,
    raw,
    span
  );
  if (isDuplicate) return NextResponse.json({ status: 'duplicate', replay: true }, { status: 200 });

  const parsedMessage = parseEvolutionMessage(raw, tenantId);
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

async function handleWaha(
  raw: WahaPayload,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  span: Span,
  tenantId: string,
  expectedSession: string
): Promise<NextResponse> {
  const instance = raw.session;
  const event = raw.event ?? '';
  const p = raw.payload ?? {};

  if (!instance) {
    return NextResponse.json({ error: 'Missing session in WAHA payload' }, { status: 400 });
  }
  if (expectedSession && instance !== expectedSession) {
    return NextResponse.json({ error: 'session_mismatch_for_tenant' }, { status: 409 });
  }

  if (event === 'session.status') {
    const status = p.status ?? '';

    if (status === 'SCAN_QR_CODE') {
      const qrCode = p.qr?.value ?? null;
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

    if (status === 'WORKING') {
      const phone = p.me?.id?.replace(/@c\.us/, '') ?? null;
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connected', phone_number: phone, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
      return NextResponse.json({ status: 'connection_updated', state: 'open' }, { status: 200 });
    }

    if (status === 'STOPPED' || status === 'FAILED') {
      await supabase
        .from('whatsapp_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('instance_name', instance);
      return NextResponse.json({ status: 'connection_updated', state: 'close' }, { status: 200 });
    }

    if (status === 'STARTING') {
      await supabase
        .from('whatsapp_connections')
        .upsert(
          { tenant_id: tenantId, instance_name: instance, status: 'connecting', updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,instance_name' }
        );
      return NextResponse.json({ status: 'connection_updated', state: 'connecting' }, { status: 200 });
    }

    defaultLogger.warn(`[WEBHOOK-WAHA] Unknown session status: ${status}`);
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  if (event === 'message') {
    if (p.id?.fromMe) {
      return NextResponse.json({ status: 'skipped_own_message' }, { status: 200 });
    }

    const messageId = p.id?._serialized;
    if (!messageId) {
      return NextResponse.json({ error: 'Missing message id' }, { status: 400 });
    }

    const isDuplicate = await handleIdempotency(
      supabase,
      'waha',
      `${tenantId}:${instance}`,
      messageId,
      raw,
      span
    );
    if (isDuplicate) return NextResponse.json({ status: 'duplicate' }, { status: 200 });

    const fromNumber = p.from?.replace(/@c\.us/, '') ?? '';
    const messageContent = p.body ?? '';
    const messageType = p.type === 'chat' ? 'text' : (p.type ?? 'unknown');

    const parsedMessage: Record<string, unknown> = {
      tenant_id: tenantId,
      from_number: fromNumber,
      to_number: instance,
      content: messageContent,
      direction: 'inbound',
      message_type: messageType,
      raw,
      media_info: p.mediaUrl ? { url: p.mediaUrl, caption: p.caption } : null,
      evolution_message_id: messageId,
      timestamp: new Date((p.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
    };

    const chatId = await upsertChat(supabase, tenantId, fromNumber);
    if (chatId) parsedMessage.chat_id = chatId;

    const messageRowId = await persistMessage(supabase, parsedMessage);
    if (!messageRowId) {
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
    }
    span.setAttribute('message.id', messageRowId);

    return routeMessage(supabase, tenantId, instance, fromNumber, messageContent, messageRowId);
  }

  defaultLogger.warn(`[WEBHOOK-WAHA] Unknown event: ${event}`);
  return NextResponse.json({ status: 'ignored' }, { status: 200 });
}

async function handleMeta(
  raw: MetaWebhookPayload,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  span: Span,
  tenantId: string,
  expectedPhoneNumberId: string
): Promise<NextResponse> {
  if (raw.object !== 'whatsapp_business_account') {
    return NextResponse.json({ status: 'ignored_non_whatsapp_payload' }, { status: 200 });
  }

  const entries = raw.entry ?? [];
  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      const metaPhoneNumberId = expectedPhoneNumberId || value.metadata?.phone_number_id;
      if (!metaPhoneNumberId) {
        defaultLogger.warn('[WEBHOOK-TENANT-META] Missing metadata.phone_number_id');
        continue;
      }

      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        await handleIdempotency(
          supabase,
          'meta',
          `${tenantId}:${metaPhoneNumberId}:status`,
          status.id,
          { type: 'status', status, value },
          span
        );
      }

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;

        const isDuplicate = await handleIdempotency(
          supabase,
          'meta',
          `${tenantId}:${metaPhoneNumberId}`,
          message.id,
          { type: 'message', message, value },
          span
        );
        if (isDuplicate) continue;

        const parsed = parseMetaMessage(message, value.metadata?.display_phone_number ?? metaPhoneNumberId, tenantId);
        if (!parsed) continue;

        const chatId = await upsertChat(supabase, tenantId, parsed.from_number as string);
        if (chatId) parsed.chat_id = chatId;

        const messageRowId = await persistMessage(supabase, parsed);
        if (!messageRowId) continue;
        span.setAttribute('message.id', messageRowId);

        await routeMessage(
          supabase,
          tenantId,
          metaPhoneNumberId,
          parsed.from_number as string,
          parsed.content as string,
          messageRowId
        );
      }
    }
  }

  return NextResponse.json({ status: 'received' }, { status: 200 });
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

function parseMetaMessage(message: MetaIncomingMessage, toNumber: string, tenantId: string): Record<string, unknown> | null {
  const messageType = message.type ?? 'unknown';
  let content = '';
  let mediaInfo: Record<string, unknown> | null = null;

  if (messageType === 'text') {
    content = message.text?.body ?? '';
  } else if (messageType === 'interactive') {
    content =
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title ??
      '';
  } else if (messageType === 'image') {
    content = message.image?.caption ?? '[Image]';
    mediaInfo = {
      mediaId: message.image?.id,
      mimeType: message.image?.mime_type,
      caption: message.image?.caption,
    };
  } else if (messageType === 'video') {
    content = message.video?.caption ?? '[Video]';
    mediaInfo = {
      mediaId: message.video?.id,
      mimeType: message.video?.mime_type,
      caption: message.video?.caption,
    };
  } else if (messageType === 'document') {
    content = message.document?.caption ?? message.document?.filename ?? '[Document]';
    mediaInfo = {
      mediaId: message.document?.id,
      mimeType: message.document?.mime_type,
      caption: message.document?.caption,
      fileName: message.document?.filename,
    };
  } else if (messageType === 'audio') {
    content = '[Audio]';
    mediaInfo = {
      mediaId: message.audio?.id,
      mimeType: message.audio?.mime_type,
    };
  }

  const ts = Number(message.timestamp ?? 0);
  return {
    tenant_id: tenantId,
    from_number: message.from,
    to_number: toNumber,
    content,
    direction: 'inbound',
    message_type: messageType,
    raw: message,
    media_info: mediaInfo,
    evolution_message_id: message.id,
    timestamp: ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
  };
}

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
    defaultLogger.error('[WEBHOOK-TENANT] Idempotency check error:', e);
  }
  span.setAttribute('webhook.is_duplicate', false);
  return false;
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
    defaultLogger.error('[WEBHOOK-TENANT] Failed to persist message:', e);
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
    defaultLogger.error('[WEBHOOK-TENANT] Failed to upsert chat:', error);
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
      defaultLogger.warn('[WEBHOOK-TENANT] Skipping malformed media message');
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
    defaultLogger.error('[WEBHOOK-TENANT] Media processing error:', e);
  }
}
