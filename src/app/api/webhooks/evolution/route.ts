import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { readRawBody as readRaw, verifyHmac, normalizePayload, enqueueJob } from '@/lib/webhooks';
import { getTenantIdByInstanceName, queueWhatsAppMessage } from '@/lib/whatsapp/messageProcessor';
import { whatsappMediaHandler } from '@/lib/whatsapp/mediaHandler';
import { trace, Span } from '@opentelemetry/api';

/**
 * POST /api/webhooks/evolution
 * 
 * Evolution/WhatsApp webhook handler. Processes incoming WhatsApp messages.
 * Requires: x-evolution-signature header with HMAC signature
 * 
 * Disabled body parsing to allow raw body verification.
 * NOTE: This route does NOT use createHttpHandler because it needs:
 * 1. Raw body access for signature verification
 * 2. Public endpoint (no auth)
 * 3. Custom HMAC verification
 */

const HEADER_NAME = 'x-evolution-signature';

// Note: Webhook POST handler - public endpoint without auth requirement
export async function POST(request: NextRequest) {
  const tracer = trace.getTracer('boka-webhook');
  const span = tracer.startSpan('webhook.evolution');

  try {
    // 1. Verify Signature
    const rawBody = await request.text();
    const signature = request.headers.get(HEADER_NAME);
    
    if (!verifySignature(rawBody, process.env.EVOLUTION_WEBHOOK_SECRET, signature, span)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody);
    const supabase = getSupabaseRouteHandlerClient();

    // 2. Idempotency Check
    const isDuplicate = await handleIdempotency(supabase, payload, signature || '', span);
    if (isDuplicate) {
      return NextResponse.json(
        { status: 'duplicate', replay: true },
        { status: 200 }
      );
    }

    // 3. Basic Payload Validation & Tenant Lookup
    const instance = payload?.instance;
    if (payload?.data?.key?.fromMe) {
      return NextResponse.json(
        { status: 'skipped_own_message' },
        { status: 200 }
      );
    }
    if (!instance) {
      return NextResponse.json(
        { error: 'Missing instance name in payload' },
        { status: 400 }
      );
    }

    const tenantId = await getTenantIdByInstanceName(instance);
    if (!tenantId) {
      console.warn(`[WEBHOOK] Received webhook for unknown instance: ${instance}`);
      return NextResponse.json(
        { error: 'Instance not found or not configured' },
        { status: 404 }
      );
    }
    span.setAttribute('tenant.id', tenantId);

    // 4. Parse and Persist Message
    const parsedMessage = parseMessage(payload, tenantId);
    if (!parsedMessage) {
      return NextResponse.json(
        { error: 'Could not parse incoming message' },
        { status: 400 }
      );
    }

    const messageRowId = await persistMessage(supabase, parsedMessage);
    if (!messageRowId) {
      return NextResponse.json(
        { error: 'Failed to save message to database' },
        { status: 500 }
      );
    }
    span.setAttribute('message.id', messageRowId);

    // 5. Process Media (if any)
    if (parsedMessage.media_info) {
      await processMedia(supabase, tenantId, parsedMessage, messageRowId);
    }

    // 6. Queue for Background Processing
    await enqueueJob(supabase, 'process_whatsapp_message', {
      message_id: messageRowId,
      tenant_id: tenantId,
    });

    return NextResponse.json(
      { status: 'accepted', messageId: messageRowId },
      { status: 202 }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown webhook processing error');
    console.error('[WEBHOOK] Unhandled error in Evolution webhook handler:', error);
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    span.end();
  }
}

function verifySignature(
  rawBody: string,
  secret: string | undefined,
  signature: string | null,
  span: Span
): boolean {
  if (!verifyHmac(rawBody, secret, signature || undefined)) {
    span.setAttribute('webhook.signature_valid', false);
    console.warn('[WEBHOOK] Invalid Evolution API signature received.');
    return false;
  }
  span.setAttribute('webhook.signature_valid', true);
  return true;
}

async function handleIdempotency(
  supabase: SupabaseClient,
  payload: any,
  signature: string,
  span: Span
): Promise<boolean> {
  try {
    const externalId = payload?.data?.key?.id || `${Date.now()}`;
    const { error } = await supabase.from('webhook_events').insert({
      provider: 'evolution',
      external_id: externalId,
      signature: signature || null,
      payload,
      processed_at: new Date().toISOString(),
    });

    if (error && error.code === '23505') {
      // Unique violation
      span.setAttribute('webhook.is_duplicate', true);
      console.log(`[WEBHOOK] Duplicate webhook event detected: ${externalId}`);
      return true;
    }
    if (error) throw error;
  } catch (e) {
    console.error('[WEBHOOK] Idempotency check database error:', e);
  }
  span.setAttribute('webhook.is_duplicate', false);
  return false;
}

function parseMessage(
  payload: any,
  tenantId: string
): Record<string, any> | null {
  const { instance, data } = payload;
  const { key, message, messageTimestamp } = data || {};
  if (!key || !message) return null;

  const remoteJid = key.remoteJid;
  const phoneNumber = remoteJid?.replace(/@s\.whatsapp\.net|@c\.us/g, '');

  let messageContent = '';
  let messageType = 'unknown';
  let mediaInfo = null;

  if (message.conversation) {
    messageContent = message.conversation;
    messageType = 'text';
  } else if (message.extendedTextMessage?.text) {
    messageContent = message.extendedTextMessage.text;
    messageType = 'text';
  } else if (message.imageMessage) {
    messageContent = message.imageMessage.caption || '';
    messageType = 'image';
    mediaInfo = {
      url: message.imageMessage.url,
      mimeType: message.imageMessage.mimetype,
      caption: message.imageMessage.caption,
      fileName: message.imageMessage.fileName,
    };
  } else if (message.videoMessage) {
    messageContent = message.videoMessage.caption || '';
    messageType = 'video';
    mediaInfo = {
      url: message.videoMessage.url,
      mimeType: message.videoMessage.mimetype,
      caption: message.videoMessage.caption,
    };
  } else if (message.documentMessage) {
    messageContent = message.documentMessage.title || message.documentMessage.fileName || 'Document';
    messageType = 'document';
    mediaInfo = {
      url: message.documentMessage.url,
      mimeType: message.documentMessage.mimetype,
      title: message.documentMessage.title,
      fileName: message.documentMessage.fileName,
    };
  } else if (message.audioMessage) {
    messageContent = '[Audio]';
    messageType = 'audio';
    mediaInfo = {
      url: message.audioMessage.url,
      mimeType: message.audioMessage.mimetype,
    };
  } else if (message.templateButtonReplyMessage?.selectedDisplayText) {
    messageContent = message.templateButtonReplyMessage.selectedDisplayText;
    messageType = 'button_reply';
  } else if (message.listResponseMessage?.title) {
    messageContent = message.listResponseMessage.title;
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
    timestamp: new Date(messageTimestamp * 1000).toISOString(),
  };
}

async function persistMessage(
  supabase: SupabaseClient,
  message: Record<string, any>
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
    console.error('[WEBHOOK] Failed to persist message to database:', e);
    return null;
  }
}

async function processMedia(
  supabase: SupabaseClient,
  tenantId: string,
  message: Record<string, any>,
  messageRowId: string
) {
  try {
    const mediaResult = await whatsappMediaHandler.processIncomingMedia(
      tenantId,
      message.from_number,
      {
        id: message.evolution_message_id,
        type: message.message_type,
        ...message.media_info,
      }
    );

    if (mediaResult.success && mediaResult.url) {
      await supabase
        .from('messages')
        .update({
          media_url: mediaResult.url,
          media_thumbnail: mediaResult.thumbnailUrl,
          media_metadata: mediaResult.metadata,
        })
        .eq('id', messageRowId);
    } else {
      console.warn(
        `[WEBHOOK] Media processing failed for message ${messageRowId}: ${mediaResult.error}`
      );
    }
  } catch (e) {
    console.error(
      `[WEBHOOK] Unhandled exception during media processing for message ${messageRowId}:`,
      e
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}
