import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { detectIntent } from '@/lib/intentDetector';
import dialogManager from '@/lib/dialogManager';
import { dialogBookingBridge } from '@/lib/dialogBookingBridge';
import { EvolutionClient } from '@/lib/whatsapp/evolutionClient';
import crypto from 'crypto';

interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type: string;
        }>;
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

interface MessageContext {
  tenantId: string;
  customerPhone: string;
  messageId: string;
  timestamp: string;
  content: string;
}

// Store processed message IDs to prevent duplicates (in production, use Redis)
const processedMessages = new Set<string>();

/**
 * GET: Webhook verification with Meta
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    console.log('✅ Webhook verified by Meta');
    return new NextResponse(challenge);
  }

  console.warn('❌ Webhook verification failed - invalid token or mode');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST: Handle incoming messages and status updates from Meta
 */
export async function POST(request: NextRequest) {
  try {
    const payload: WhatsAppWebhookPayload = await request.json();

    // Verify webhook signature
    const signature = request.headers.get('x-hub-signature-256');
    if (!verifySignature(payload, signature)) {
      console.warn('❌ Invalid webhook signature');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (payload.object !== 'whatsapp_business_account') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Process webhook asynchronously (don't block response)
    processWebhookAsync(payload).catch(error => {
      console.error('Error processing webhook in background:', error);
    });

    // Immediately return 200 to acknowledge receipt
    return NextResponse.json({ status: 'received' }, { status: 200 });

  } catch (error) {
    console.error('Webhook parsing error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Verify Meta webhook signature
 */
function verifySignature(payload: any, signature: string | null): boolean {
  if (!signature) return false;

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false;

  const hash = crypto
    .createHmac('sha256', appSecret)
    .update(JSON.stringify(payload))
    .digest('hex');

  const expectedSignature = `sha256=${hash}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Process webhook payload asynchronously
 */
async function processWebhookAsync(payload: WhatsAppWebhookPayload): Promise<void> {
  const supabase = getSupabaseRouteHandlerClient();

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      // Handle messages
      if (change.field === 'messages' && change.value.messages) {
        for (const message of change.value.messages) {
          await handleIncomingMessage(message, change.value.metadata, supabase);
        }
      }

      // Handle delivery/read status updates
      if (change.field === 'message_status' && change.value.statuses) {
        for (const status of change.value.statuses) {
          await handleMessageStatus(status, supabase);
        }
      }
    }
  }
}

/**
 * Handle incoming message from customer
 */
async function handleIncomingMessage(
  message: any,
  metadata: any,
  supabase: any
): Promise<void> {
  const messageId = message.id;
  const customerPhone = message.from;
  const timestamp = new Date(parseInt(message.timestamp) * 1000).toISOString();

  // Skip if already processed (idempotency)
  if (processedMessages.has(messageId)) {
    console.log(`⏭️  Message ${messageId} already processed, skipping`);
    return;
  }

  if (message.type !== 'text') {
    console.log(`⏭️  Skipping non-text message type: ${message.type}`);
    return;
  }

  const messageContent = message.text.body.trim();
  console.log(`📨 Received message from ${customerPhone}: "${messageContent}"`);

  try {
    // Find tenant by phone number (lookup in whatsapp_connections)
    const { data: connection, error: connErr } = await supabase
      .from('whatsapp_connections')
      .select('tenant_id')
      .eq('phone_number', customerPhone)
      .maybeSingle();

    if (connErr || !connection) {
      console.warn(`No tenant found for phone ${customerPhone}`);
      // Send fallback message (optional)
      return;
    }

    const tenantId = connection.tenant_id;

    // Store message in queue for processing
    const { error: queueErr } = await supabase
      .from('whatsapp_message_queue')
      .insert({
        tenant_id: tenantId,
        message_id: messageId,
        from_number: customerPhone,
        to_number: metadata.display_phone_number,
        content: messageContent,
        priority: 'normal',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        metadata: { raw_message: message },
        created_at: timestamp,
      });

    if (queueErr) {
      console.error('Failed to queue message:', queueErr);
      return;
    }

    processedMessages.add(messageId);

    // Process message immediately (don't wait for batch)
    await processQueuedMessage(messageId, tenantId, customerPhone, messageContent, supabase);

  } catch (error) {
    console.error(`Error handling message ${messageId}:`, error);
  }
}

/**
 * Process a queued message through the booking flow
 */
async function processQueuedMessage(
  messageId: string,
  tenantId: string,
  customerPhone: string,
  messageContent: string,
  supabase: any
): Promise<void> {
  const evolutionClient = new EvolutionClient();

  try {
    // Update status to processing
    await supabase
      .from('whatsapp_message_queue')
      .update({ status: 'processing' })
      .eq('message_id', messageId);

    // Get or create dialog session
    let sessionId = await dialogManager.getSessionIdByPhone(tenantId, customerPhone);
    if (!sessionId) {
      sessionId = await dialogManager.startSession(tenantId);
      // Link session to customer phone
      await supabase
        .from('dialog_sessions')
        .update({ metadata: { phone: customerPhone } })
        .eq('id', sessionId);
    }

    // Detect user intent from message
    const intent = await detectIntent(messageContent, undefined, tenantId);
    console.log(`🎯 Intent detected: ${intent.intent} (confidence: ${intent.confidence})`);

    // Get current dialog state
    const state = await dialogManager.getSession(sessionId);
    if (!state) {
      throw new Error('Failed to retrieve dialog session');
    }

    // Route to booking bridge
    const response = await dialogBookingBridge.handleMessage(
      tenantId,
      sessionId,
      messageContent,
      intent
    );

    // Send response back to customer
    if (response) {
      await evolutionClient.sendMessage(tenantId, customerPhone, response);
      console.log(`✅ Sent response to ${customerPhone}: "${response.substring(0, 50)}..."`);
    }

    // Mark message as completed
    await supabase
      .from('whatsapp_message_queue')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('message_id', messageId);

  } catch (error) {
    console.error(`❌ Error processing message ${messageId}:`, error);

    // Update status to failed
    await supabase
      .from('whatsapp_message_queue')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('message_id', messageId);

    // Send error message to customer
    try {
      await evolutionClient.sendMessage(
        tenantId,
        customerPhone,
        'Sorry, something went wrong. Please try again or contact support.'
      );
    } catch (sendErr) {
      console.error('Failed to send error message:', sendErr);
    }
  }
}

/**
 * Handle message delivery/read status updates
 */
async function handleMessageStatus(status: any, supabase: any): Promise<void> {
  const { id: messageId, status: deliveryStatus, timestamp } = status;

  console.log(`📦 Message ${messageId} status: ${deliveryStatus}`);

  try {
    // Update message status in database
    await supabase
      .from('whatsapp_message_log')
      .update({
        delivery_status: deliveryStatus,
        delivered_at: new Date(parseInt(timestamp) * 1000).toISOString(),
      })
      .eq('message_id', messageId);

  } catch (error) {
    console.error(`Error updating message status:`, error);
  }
}
