export const dynamic = 'force-dynamic';

import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueJob } from '@/lib/webhooks';
import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { ingestQualityWebhook } from '@/lib/whatsapp/v2/deliverability/metaQualityWebhook';

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

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function verifyMetaSignature(rawBody: string, incomingSignature: string | null, appSecret: string): boolean {
  if (!incomingSignature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const incomingBuffer = Buffer.from(incomingSignature);
  return (
    expectedBuffer.length === incomingBuffer.length &&
    timingSafeEqual(expectedBuffer, incomingBuffer)
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expectedToken =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    '';

  if (mode === 'subscribe' && token && challenge && expectedToken && token === expectedToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const payload = safeJsonParse<MetaWebhookPayload>(rawBody);
  if (!payload) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  if (!appSecret) {
    defaultLogger.error('[WEBHOOK-META] WHATSAPP_APP_SECRET not configured');
    return NextResponse.json({ error: 'misconfigured_webhook_secret' }, { status: 500 });
  }

  const incomingSignature = request.headers.get('x-hub-signature-256');
  if (!verifyMetaSignature(rawBody, incomingSignature, appSecret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  if (payload.object !== 'whatsapp_business_account') {
    return NextResponse.json({ status: 'ignored_non_whatsapp_payload' }, { status: 200 });
  }

  const supabase = createSupabaseAdminClient();
  const entries = payload.entry ?? [];

  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (
        ['phone_number_quality_update', 'messaging_limits', 'account_update', 'message_template_status_update']
          .includes(change.field ?? '')
      ) {
        await ingestQualityWebhook(supabase as never, change);
        continue;
      }

      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      const metaPhoneNumberId = value.metadata?.phone_number_id;
      if (!metaPhoneNumberId) {
        defaultLogger.warn('[WEBHOOK-META] Missing metadata.phone_number_id');
        continue;
      }

      const { data: config, error: configError } = await supabase
        .from('whatsapp_configurations')
        .select('tenant_id, instance_name, provider, active')
        .eq('provider', 'meta')
        .eq('meta_phone_number_id', metaPhoneNumberId)
        .eq('active', true)
        .maybeSingle();

      if (configError) {
        defaultLogger.error('[WEBHOOK-META] Config lookup failed', configError);
        continue;
      }

      if (!config?.tenant_id) {
        defaultLogger.warn('[WEBHOOK-META] No active tenant mapped to phone_number_id', { metaPhoneNumberId });
        continue;
      }

      const tenantId = config.tenant_id as string;
      const instanceName = (config.instance_name as string) || metaPhoneNumberId;

      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        await handleIdempotency(
          supabase,
          'meta',
          `${metaPhoneNumberId}:status`,
          status.id,
          { type: 'status', status, value }
        );
      }

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;

        const isDuplicate = await handleIdempotency(
          supabase,
          'meta',
          metaPhoneNumberId,
          message.id,
          { type: 'message', message, value }
        );
        if (isDuplicate) continue;

        const parsed = parseMetaMessage(message, value.metadata?.display_phone_number ?? metaPhoneNumberId, tenantId);
        if (!parsed) continue;

        const chatId = await upsertChat(supabase, tenantId, parsed.from_number as string);
        if (chatId) parsed.chat_id = chatId;

        const messageRowId = await persistMessage(supabase, parsed);
        if (!messageRowId) continue;

        await routeMessage(
          supabase,
          tenantId,
          instanceName,
          parsed.from_number as string,
          parsed.content as string,
          messageRowId
        );
      }
    }
  }

  return NextResponse.json({ status: 'received' }, { status: 200 });
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

async function handleIdempotency(
  supabase: SupabaseClient,
  provider: 'evolution' | 'waha' | 'meta',
  instanceScope: string,
  messageId: string,
  payload: unknown
): Promise<boolean> {
  try {
    const externalId = `${instanceScope}:${messageId}`;
    const { error } = await supabase.from('webhook_events').insert({
      provider,
      external_id: externalId,
      payload,
      processed_at: new Date().toISOString(),
    });
    if (error?.code === '23505') return true;
    if (error) throw error;
  } catch (e) {
    defaultLogger.error('[WEBHOOK-META] Idempotency check error', e);
  }
  return false;
}

async function persistMessage(
  supabase: SupabaseClient,
  message: Record<string, unknown>
): Promise<string | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert(message)
    .select('id')
    .single();
  if (error) {
    defaultLogger.error('[WEBHOOK-META] Failed to persist message', error);
    return null;
  }
  return data.id as string;
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
    defaultLogger.error('[WEBHOOK-META] Failed to upsert chat', error);
    return null;
  }
  return data.id as string;
}

async function routeMessage(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  tenantId: string,
  instance: string,
  fromNumber: string,
  content: string,
  messageRowId: string
): Promise<void> {
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
    return;
  }

  await enqueueJob(supabase, 'process_whatsapp_message', {
    message_id: messageRowId,
    tenant_id: tenantId,
  });
}
