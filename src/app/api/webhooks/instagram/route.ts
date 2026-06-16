export const dynamic = 'force-dynamic';

import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { findTenantByInstagramId } from '@/lib/instagram/secrets';

/**
 * Instagram messaging webhook (Instagram API with Instagram Login, Graph API v25.0).
 *
 * GET  — verification handshake (echoes hub.challenge).
 * POST — incoming DMs. Verifies X-Hub-Signature-256 (HMAC-SHA256 with the app secret),
 *        maps the recipient IG business account id -> tenant, de-dupes, persists, and
 *        routes into the shared v2 pipeline with channel='instagram'.
 *
 * Instagram is capture-only: replies are bound to the 24-hour messaging window, so this
 * channel reuses the v2 booking flow but WhatsApp remains the proactive/lifecycle channel.
 */

interface IgMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
}

interface IgWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string; // the tenant's IG business account id (recipient)
    time?: number;
    messaging?: IgMessaging[];
  }>;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function verifySignature(rawBody: string, incomingSignature: string | null, appSecret: string): boolean {
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
  const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '';

  if (mode === 'subscribe' && token && challenge && expectedToken && token === expectedToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const appSecret = process.env.INSTAGRAM_APP_SECRET || '';
  if (!appSecret) {
    defaultLogger.error('[WEBHOOK-IG] INSTAGRAM_APP_SECRET not configured');
    return NextResponse.json({ error: 'misconfigured_webhook_secret' }, { status: 500 });
  }

  const incomingSignature = request.headers.get('x-hub-signature-256');
  if (!verifySignature(rawBody, incomingSignature, appSecret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const payload = safeJsonParse<IgWebhookPayload>(rawBody);
  if (!payload) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (payload.object !== 'instagram') {
    return NextResponse.json({ status: 'ignored_non_instagram_payload' }, { status: 200 });
  }

  const supabase = createSupabaseAdminClient();

  for (const entry of payload.entry ?? []) {
    const igAccountId = entry.id;
    if (!igAccountId) continue;

    // Resolve which tenant owns this Instagram account.
    const tenantId = await findTenantByInstagramId(supabase, igAccountId);
    if (!tenantId) {
      defaultLogger.warn('[WEBHOOK-IG] No tenant mapped to IG account', { igAccountId });
      continue;
    }

    for (const event of entry.messaging ?? []) {
      const msg = event.message;
      // Skip echoes (messages our own account sent) and non-message events.
      if (!msg || msg.is_echo) continue;

      const senderId = event.sender?.id;
      const mid = msg.mid;
      if (!senderId || !mid) continue;
      // Ignore self (recipient === sender shouldn't happen for inbound, but guard anyway).
      if (senderId === igAccountId) continue;

      const isDuplicate = await handleIdempotency(supabase, igAccountId, mid, { event });
      if (isDuplicate) continue;

      const content = extractContent(msg);

      const parsed = {
        tenant_id: tenantId,
        from_number: senderId,
        to_number: igAccountId,
        content,
        direction: 'inbound',
        message_type: msg.text ? 'text' : 'attachment',
        raw: event,
        evolution_message_id: mid,
        timestamp: event.timestamp
          ? new Date(event.timestamp).toISOString()
          : new Date().toISOString(),
      } as Record<string, unknown>;

      const chatId = await upsertChat(supabase, tenantId, senderId);
      if (chatId) parsed.chat_id = chatId;

      const messageRowId = await persistMessage(supabase, parsed);
      if (!messageRowId) continue;

      await routeMessage(supabase, tenantId, igAccountId, senderId, content, messageRowId);
    }
  }

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

function extractContent(msg: NonNullable<IgMessaging['message']>): string {
  if (msg.text) return msg.text;
  if (msg.attachments?.length) {
    const type = msg.attachments[0]?.type ?? 'attachment';
    return `[${type}]`;
  }
  return '';
}

async function handleIdempotency(
  supabase: SupabaseClient,
  igAccountId: string,
  messageId: string,
  payload: unknown
): Promise<boolean> {
  try {
    const externalId = `${igAccountId}:${messageId}`;
    const { error } = await supabase.from('webhook_events').insert({
      provider: 'instagram',
      external_id: externalId,
      payload,
      processed_at: new Date().toISOString(),
    });
    if (error?.code === '23505') return true; // already seen (UNIQUE(provider, external_id))
    if (error) throw error;
  } catch (e) {
    defaultLogger.error('[WEBHOOK-IG] Idempotency check error', e);
  }
  return false;
}

async function persistMessage(
  supabase: SupabaseClient,
  message: Record<string, unknown>
): Promise<string | null> {
  const { data, error } = await supabase.from('messages').insert(message).select('id').single();
  if (error) {
    defaultLogger.error('[WEBHOOK-IG] Failed to persist message', error);
    return null;
  }
  return data.id as string;
}

async function upsertChat(
  supabase: SupabaseClient,
  tenantId: string,
  externalId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('chats')
    .upsert(
      { tenant_id: tenantId, customer_phone: externalId, last_message_at: new Date().toISOString() },
      { onConflict: 'tenant_id,customer_phone' }
    )
    .select('id')
    .single();
  if (error) {
    defaultLogger.error('[WEBHOOK-IG] Failed to upsert chat', error);
    return null;
  }
  return data.id as string;
}

async function routeMessage(
  supabase: SupabaseClient,
  tenantId: string,
  igAccountId: string,
  senderId: string,
  content: string,
  messageRowId: string
): Promise<void> {
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('v2_enabled')
    .eq('id', tenantId)
    .maybeSingle();

  // Instagram is handled only by the v2 pipeline.
  if (!tenantRow?.v2_enabled) {
    defaultLogger.warn('[WEBHOOK-IG] Tenant not v2-enabled; Instagram requires v2 — skipping', {
      tenantId,
    });
    return;
  }

  const { appendPendingMessage } = await import('@/lib/whatsapp/v2/messageBatcher');
  const { resolveIncoming } = await import('@/lib/whatsapp/v2/identityResolver');
  const { ensureConversation } = await import('@/lib/whatsapp/v2/conversationState');

  // recipient mapping already gave us the tenant; identity fills role for known convos.
  const identity = await resolveIncoming('instagram', senderId, content);
  const resolvedTenantId = identity.tenantId ?? tenantId;
  const role = identity.role;
  const text = identity.strippedMessage || content;

  await ensureConversation(senderId, resolvedTenantId, role, 'instagram');
  await appendPendingMessage(senderId, resolvedTenantId, text, messageRowId, 'instagram');

  await supabase.from('whatsapp_message_queue').insert({
    tenant_id: resolvedTenantId,
    message_id: messageRowId,
    from_number: senderId,
    to_number: igAccountId,
    content: text,
    status: 'pending',
    priority: 'normal',
    channel: 'instagram',
  });

  if (process.env.NODE_ENV !== 'production') {
    const workerBase = process.env.APP_URL || 'http://localhost:3000';
    fetch(`${workerBase}/api/worker/whatsapp`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET || 'dev-cron-secret'}` },
    }).catch(() => {});
  }
}
