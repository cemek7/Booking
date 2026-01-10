/**
 * Webhook Utilities - Production Ready
 * 
 * Core utilities for webhook processing including:
 * - Raw body reading and parsing
 * - HMAC signature verification
 * - Payload normalization
 * - Error handling and logging
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createHash, createHmac } from 'crypto';
import { z } from 'zod';
import { WebhookSecurityService } from './security';

// ===============================
// WEBHOOK UTILITIES
// ===============================

/**
 * Read raw body from Next.js API request
 * Essential for signature verification as the body must not be parsed
 */
export async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    
    req.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Verify HMAC signature for webhook authenticity
 */
export function verifyHmac(
  payload: string | Buffer,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): boolean {
  try {
    const payloadString = typeof payload === 'string' ? payload : payload.toString();
    const computedSignature = createHmac(algorithm, secret)
      .update(payloadString)
      .digest('hex');
    
    // Remove potential prefix (e.g., "sha256=" from GitHub)
    const cleanSignature = signature.replace(/^(sha256|sha1)=/, '');
    
    return computedSignature === cleanSignature;
  } catch (error) {
    console.error('HMAC verification error:', error);
    return false;
  }
}

/**
 * Normalize webhook payload from different providers
 */
export function normalizePayload(payload: any, provider: string): NormalizedWebhook {
  switch (provider.toLowerCase()) {
    case 'stripe':
      return normalizeStripePayload(payload);
    case 'paystack':
      return normalizePaystackPayload(payload);
    case 'evolution':
      return normalizeEvolutionPayload(payload);
    case 'whatsapp':
      return normalizeWhatsAppPayload(payload);
    default:
      return {
        id: payload.id || generateEventId(),
        type: payload.type || 'unknown',
        provider,
        timestamp: payload.timestamp || Date.now(),
        data: payload,
        metadata: {}
      };
  }
}

// ===============================
// NORMALIZED WEBHOOK INTERFACE
// ===============================

interface NormalizedWebhook {
  id: string;
  type: string;
  provider: string;
  timestamp: number;
  data: any;
  metadata: {
    originalType?: string;
    customerId?: string;
    amount?: number;
    currency?: string;
    status?: string;
    [key: string]: any;
  };
}

// ===============================
// PROVIDER-SPECIFIC NORMALIZERS
// ===============================

function normalizeStripePayload(payload: any): NormalizedWebhook {
  return {
    id: payload.id,
    type: mapStripeEventType(payload.type),
    provider: 'stripe',
    timestamp: payload.created * 1000, // Stripe uses Unix timestamp
    data: payload,
    metadata: {
      originalType: payload.type,
      customerId: payload.data?.object?.customer,
      amount: payload.data?.object?.amount,
      currency: payload.data?.object?.currency,
      status: payload.data?.object?.status
    }
  };
}

function normalizePaystackPayload(payload: any): NormalizedWebhook {
  return {
    id: payload.data?.id || payload.id,
    type: mapPaystackEventType(payload.event),
    provider: 'paystack',
    timestamp: new Date(payload.data?.created_at || payload.created_at).getTime(),
    data: payload,
    metadata: {
      originalType: payload.event,
      customerId: payload.data?.customer?.id,
      amount: payload.data?.amount,
      currency: payload.data?.currency,
      status: payload.data?.status
    }
  };
}

function normalizeEvolutionPayload(payload: any): NormalizedWebhook {
  return {
    id: payload.key || payload.messageId || generateEventId(),
    type: mapEvolutionEventType(payload.event),
    provider: 'evolution',
    timestamp: payload.timestamp || Date.now(),
    data: payload,
    metadata: {
      originalType: payload.event,
      messageType: payload.data?.messageType,
      instanceId: payload.instance,
      fromNumber: payload.data?.key?.remoteJid,
      messageId: payload.data?.key?.id
    }
  };
}

function normalizeWhatsAppPayload(payload: any): NormalizedWebhook {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  
  return {
    id: entry?.id || generateEventId(),
    type: mapWhatsAppEventType(change?.field),
    provider: 'whatsapp',
    timestamp: Date.now(),
    data: payload,
    metadata: {
      originalType: change?.field,
      phoneNumberId: value?.metadata?.phone_number_id,
      displayPhoneNumber: value?.metadata?.display_phone_number,
      messageCount: value?.messages?.length || 0,
      statusCount: value?.statuses?.length || 0
    }
  };
}

// ===============================
// EVENT TYPE MAPPING
// ===============================

function mapStripeEventType(type: string): string {
  const typeMap: Record<string, string> = {
    'payment_intent.succeeded': 'payment.completed',
    'payment_intent.payment_failed': 'payment.failed',
    'payment_intent.canceled': 'payment.canceled',
    'invoice.paid': 'invoice.paid',
    'invoice.payment_failed': 'invoice.failed',
    'customer.created': 'customer.created',
    'customer.updated': 'customer.updated'
  };
  
  return typeMap[type] || type;
}

function mapPaystackEventType(type: string): string {
  const typeMap: Record<string, string> = {
    'charge.success': 'payment.completed',
    'charge.failed': 'payment.failed',
    'transfer.success': 'transfer.completed',
    'transfer.failed': 'transfer.failed'
  };
  
  return typeMap[type] || type;
}

function mapEvolutionEventType(type: string): string {
  const typeMap: Record<string, string> = {
    'messages.upsert': 'message.received',
    'messages.update': 'message.updated',
    'presence.update': 'presence.changed',
    'connection.update': 'connection.changed'
  };
  
  return typeMap[type] || type;
}

function mapWhatsAppEventType(field: string): string {
  const typeMap: Record<string, string> = {
    'messages': 'message.received',
    'message_status': 'message.status_changed'
  };
  
  return typeMap[field] || field;
}

// ===============================
// WEBHOOK PROCESSOR
// ===============================

export class WebhookProcessor {
  private securityService: WebhookSecurityService;
  
  constructor() {
    this.securityService = new WebhookSecurityService();
  }

  /**
   * Process webhook with full security validation and normalization
   */
  async processWebhook(
    req: NextApiRequest,
    res: NextApiResponse,
    provider: string,
    secret: string,
    handler: (webhook: NormalizedWebhook) => Promise<void>
  ): Promise<void> {
    try {
      // 1. Read raw body
      const rawBody = await readRawBody(req);
      
      if (!rawBody || rawBody.length === 0) {
        return this.sendError(res, 400, 'EMPTY_BODY', 'Request body is empty');
      }

      // 2. Validate webhook security
      const validationResult = await this.securityService.validateWebhook(
        provider,
        req.headers as Record<string, string>,
        rawBody,
        secret
      );

      if (!validationResult.isValid) {
        return this.sendError(
          res,
          validationResult.rateLimitExceeded ? 429 : 401,
          validationResult.rateLimitExceeded ? 'RATE_LIMITED' : 'INVALID_SIGNATURE',
          validationResult.error || 'Webhook validation failed'
        );
      }

      // 3. Handle duplicates gracefully
      if (validationResult.isDuplicate) {
        return res.status(200).json({
          success: true,
          message: 'Event already processed',
          eventId: validationResult.eventId
        });
      }

      // 4. Parse payload
      let payload;
      try {
        payload = JSON.parse(rawBody.toString());
      } catch (error) {
        return this.sendError(res, 400, 'INVALID_JSON', 'Invalid JSON payload');
      }

      // 5. Normalize webhook payload
      const normalizedWebhook = normalizePayload(payload, provider);

      // 6. Execute handler
      await handler(normalizedWebhook);

      // 7. Send success response
      res.status(200).json({
        success: true,
        eventId: validationResult.eventId || normalizedWebhook.id,
        message: 'Webhook processed successfully'
      });

    } catch (error) {
      console.error(`Webhook processing error for ${provider}:`, error);
      
      return this.sendError(
        res,
        500,
        'PROCESSING_ERROR',
        error instanceof Error ? error.message : 'Internal server error'
      );
    }
  }

  /**
   * Send standardized error response
   */
  private sendError(
    res: NextApiResponse,
    status: number,
    code: string,
    message: string
  ): void {
    res.status(status).json({
      success: false,
      error: {
        code,
        message
      },
      timestamp: new Date().toISOString()
    });
  }
}

// ===============================
// WEBHOOK HANDLER FACTORY
// ===============================

/**
 * Create a secure webhook handler for Next.js API routes
 */
export function createWebhookHandler(
  provider: string,
  secret: string,
  handler: (webhook: NormalizedWebhook) => Promise<void>
) {
  const processor = new WebhookProcessor();

  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST method allowed' }
      });
    }

    await processor.processWebhook(req, res, provider, secret, handler);
  };
}

// ===============================
// UTILITY FUNCTIONS
// ===============================

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract IP address from request
 */
export function extractIPAddress(req: NextApiRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
    (req.headers['x-real-ip'] as string) ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Create payload hash for security logging
 */
export function createPayloadHash(payload: string | Buffer): string {
  const payloadString = typeof payload === 'string' ? payload : payload.toString();
  return createHash('sha256').update(payloadString).digest('hex');
}

/**
 * Validate required environment variables
 */
export function validateWebhookEnv(): {
  isValid: boolean;
  missingVars: string[];
  warnings: string[];
} {
  const requiredVars = [
    'STRIPE_WEBHOOK_SECRET',
    'PAYSTACK_WEBHOOK_SECRET',
    'EVOLUTION_WEBHOOK_SECRET'
  ];

  const optionalVars = [
    'WHATSAPP_WEBHOOK_SECRET'
  ];

  const missingVars: string[] = [];
  const warnings: string[] = [];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  optionalVars.forEach(varName => {
    if (!process.env[varName]) {
      warnings.push(`${varName} not set - WhatsApp webhooks will be disabled`);
    }
  });

  return {
    isValid: missingVars.length === 0,
    missingVars,
    warnings
  };
}

// ===============================
// WEBHOOK TESTING UTILITIES
// ===============================

/**
 * Generate test webhook payload for development
 */
export function generateTestWebhook(provider: string, eventType: string): any {
  const basePayload = {
    id: `test_${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    type: eventType
  };

  switch (provider.toLowerCase()) {
    case 'stripe':
      return {
        ...basePayload,
        api_version: '2020-08-27',
        data: {
          object: {
            id: 'pi_test_123',
            amount: 5000,
            currency: 'usd',
            status: 'succeeded',
            customer: 'cus_test_123'
          }
        },
        livemode: false,
        object: 'event'
      };

    case 'paystack':
      return {
        event: eventType,
        data: {
          id: 12345,
          amount: 500000,
          currency: 'NGN',
          status: 'success',
          created_at: new Date().toISOString(),
          customer: { id: 'cus_test_123', email: 'test@example.com' }
        }
      };

    case 'evolution':
      return {
        event: eventType,
        instance: 'test_instance',
        data: {
          key: { remoteJid: '1234567890@s.whatsapp.net', id: 'test_msg_123' },
          messageType: 'conversation',
          message: { conversation: 'Test message' }
        },
        timestamp: Date.now()
      };

    default:
      return basePayload;
  }
}

/**
 * Sign test webhook for development
 */
export function signTestWebhook(
  payload: any,
  secret: string,
  provider: string
): { payload: string; signature: string; headers: Record<string, string> } {
  const payloadString = JSON.stringify(payload);
  
  switch (provider.toLowerCase()) {
    case 'stripe': {
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payloadString}`;
      const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');
      
      return {
        payload: payloadString,
        signature: `t=${timestamp},v1=${signature}`,
        headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` }
      };
    }
    
    case 'paystack': {
      const signature = createHmac('sha512', secret).update(payloadString).digest('hex');
      
      return {
        payload: payloadString,
        signature,
        headers: { 'x-paystack-signature': signature }
      };
    }
    
    case 'evolution': {
      const signature = createHmac('sha256', secret).update(payloadString).digest('hex');
      
      return {
        payload: payloadString,
        signature,
        headers: { 'x-hub-signature-256': `sha256=${signature}` }
      };
    }
    
    default: {
      const signature = createHmac('sha256', secret).update(payloadString).digest('hex');
      
      return {
        payload: payloadString,
        signature,
        headers: { 'x-signature': signature }
      };
    }
  }
}

export { NormalizedWebhook, WebhookProcessor };