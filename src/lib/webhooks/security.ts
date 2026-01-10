/**
 * Webhook Security Framework - Production Grade
 * 
 * Implements comprehensive webhook security including:
 * - Signature verification for all supported providers
 * - Replay attack prevention
 * - Rate limiting and abuse protection
 * - Event deduplication
 * - Secure payload parsing
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';

// ===============================
// WEBHOOK SECURITY CONFIGURATION
// ===============================

export interface WebhookProvider {
  name: string;
  signatureHeader: string;
  timestampHeader?: string;
  signaturePrefix?: string;
  algorithm: 'sha256' | 'sha1';
  timestampTolerance?: number; // seconds
}

export const WEBHOOK_PROVIDERS: Record<string, WebhookProvider> = {
  stripe: {
    name: 'Stripe',
    signatureHeader: 'stripe-signature',
    timestampHeader: 'stripe-signature', // embedded in signature
    signaturePrefix: 'v1=',
    algorithm: 'sha256',
    timestampTolerance: 300 // 5 minutes
  },
  paystack: {
    name: 'Paystack',
    signatureHeader: 'x-paystack-signature',
    algorithm: 'sha512',
    timestampTolerance: 600 // 10 minutes
  },
  evolution: {
    name: 'Evolution API',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
    algorithm: 'sha256',
    timestampTolerance: 300
  },
  whatsapp: {
    name: 'WhatsApp Business',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
    algorithm: 'sha256',
    timestampTolerance: 300
  }
};

// ===============================
// SECURITY VALIDATION SCHEMAS
// ===============================

const WebhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  provider: z.string().min(1),
  timestamp: z.number(),
  signature: z.string().min(1),
  payload: z.record(z.any()),
  metadata: z.record(z.any()).optional()
});

const SecurityValidationResultSchema = z.object({
  isValid: z.boolean(),
  error?: z.string(),
  eventId?: z.string(),
  isDuplicate?: z.boolean(),
  isReplay?: z.boolean(),
  rateLimitExceeded?: z.boolean()
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type SecurityValidationResult = z.infer<typeof SecurityValidationResultSchema>;

// ===============================
// WEBHOOK SECURITY SERVICE
// ===============================

export class WebhookSecurityService {
  private readonly supabase;
  private readonly rateLimitCache = new Map<string, { count: number; resetTime: number }>();
  
  constructor() {
    this.supabase = getSupabaseRouteHandlerClient();
  }

  /**
   * Comprehensive webhook validation
   */
  async validateWebhook(
    provider: string,
    headers: Record<string, string | undefined>,
    rawBody: string | Buffer,
    secret: string
  ): Promise<SecurityValidationResult> {
    try {
      const providerConfig = WEBHOOK_PROVIDERS[provider.toLowerCase()];
      if (!providerConfig) {
        return { isValid: false, error: `Unknown provider: ${provider}` };
      }

      // 1. Extract signature from headers
      const signatureResult = this.extractSignature(headers, providerConfig);
      if (!signatureResult.isValid) {
        return signatureResult;
      }

      // 2. Verify cryptographic signature
      const verificationResult = this.verifySignature(
        rawBody,
        signatureResult.signature!,
        secret,
        providerConfig
      );
      if (!verificationResult.isValid) {
        return verificationResult;
      }

      // 3. Check for timestamp validity (replay protection)
      const timestampResult = await this.validateTimestamp(
        headers,
        providerConfig,
        signatureResult.timestamp
      );
      if (!timestampResult.isValid) {
        return { ...timestampResult, isReplay: true };
      }

      // 4. Parse and validate payload structure
      let payload;
      try {
        payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString());
      } catch (error) {
        return { isValid: false, error: 'Invalid JSON payload' };
      }

      // 5. Extract event ID for deduplication
      const eventId = this.extractEventId(payload, provider);
      if (!eventId) {
        return { isValid: false, error: 'Missing event ID in payload' };
      }

      // 6. Check for duplicate events
      const duplicateResult = await this.checkDuplicate(eventId, provider);
      if (duplicateResult.isDuplicate) {
        return { isValid: true, isDuplicate: true, eventId };
      }

      // 7. Rate limiting check
      const rateLimitResult = this.checkRateLimit(provider);
      if (!rateLimitResult.isValid) {
        return { ...rateLimitResult, rateLimitExceeded: true };
      }

      // 8. Store validated event
      await this.storeValidatedEvent({
        id: eventId,
        type: this.extractEventType(payload, provider),
        provider,
        timestamp: Date.now(),
        signature: signatureResult.signature!,
        payload,
        metadata: {
          userAgent: headers['user-agent'],
          forwardedFor: headers['x-forwarded-for'],
          realIp: headers['x-real-ip']
        }
      });

      return {
        isValid: true,
        eventId,
        isDuplicate: false,
        isReplay: false,
        rateLimitExceeded: false
      };

    } catch (error) {
      console.error('Webhook validation error:', error);
      return { 
        isValid: false, 
        error: error instanceof Error ? error.message : 'Unknown validation error' 
      };
    }
  }

  /**
   * Extract signature from headers based on provider configuration
   */
  private extractSignature(
    headers: Record<string, string | undefined>,
    config: WebhookProvider
  ): SecurityValidationResult & { signature?: string; timestamp?: number } {
    const signatureHeader = headers[config.signatureHeader];
    
    if (!signatureHeader) {
      return { 
        isValid: false, 
        error: `Missing signature header: ${config.signatureHeader}` 
      };
    }

    // Handle Stripe's complex signature format: t=timestamp,v1=signature
    if (config.name === 'Stripe') {
      const elements = signatureHeader.split(',');
      let timestamp: number | undefined;
      let signature: string | undefined;

      for (const element of elements) {
        const [key, value] = element.split('=');
        if (key === 't') {
          timestamp = parseInt(value, 10);
        } else if (key === 'v1') {
          signature = value;
        }
      }

      if (!signature || !timestamp) {
        return { isValid: false, error: 'Invalid Stripe signature format' };
      }

      return { isValid: true, signature, timestamp };
    }

    // Handle other providers with simple signature format
    let signature = signatureHeader;
    if (config.signaturePrefix) {
      if (!signature.startsWith(config.signaturePrefix)) {
        return { 
          isValid: false, 
          error: `Invalid signature prefix for ${config.name}` 
        };
      }
      signature = signature.slice(config.signaturePrefix.length);
    }

    return { isValid: true, signature };
  }

  /**
   * Verify cryptographic signature
   */
  private verifySignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
    config: WebhookProvider
  ): SecurityValidationResult {
    try {
      const payloadString = typeof payload === 'string' ? payload : payload.toString();
      const expectedSignature = createHmac(config.algorithm, secret)
        .update(payloadString)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      const signatureBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (signatureBuffer.length !== expectedBuffer.length) {
        return { isValid: false, error: 'Signature length mismatch' };
      }

      if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return { isValid: false, error: 'Signature verification failed' };
      }

      return { isValid: true };

    } catch (error) {
      return { 
        isValid: false, 
        error: `Signature verification error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Validate timestamp to prevent replay attacks
   */
  private async validateTimestamp(
    headers: Record<string, string | undefined>,
    config: WebhookProvider,
    timestamp?: number
  ): Promise<SecurityValidationResult> {
    if (!config.timestampTolerance) {
      return { isValid: true }; // No timestamp validation required
    }

    const now = Math.floor(Date.now() / 1000);
    let eventTimestamp = timestamp;

    // If timestamp not already extracted, try to get it from headers
    if (!eventTimestamp && config.timestampHeader) {
      const timestampHeader = headers[config.timestampHeader];
      if (timestampHeader) {
        eventTimestamp = parseInt(timestampHeader, 10);
      }
    }

    if (!eventTimestamp) {
      return { isValid: false, error: 'Missing timestamp for replay protection' };
    }

    const timeDiff = Math.abs(now - eventTimestamp);
    if (timeDiff > config.timestampTolerance) {
      return { 
        isValid: false, 
        error: `Timestamp outside tolerance window: ${timeDiff}s > ${config.timestampTolerance}s` 
      };
    }

    return { isValid: true };
  }

  /**
   * Extract event ID for deduplication
   */
  private extractEventId(payload: any, provider: string): string | null {
    const idFields = {
      stripe: 'id',
      paystack: 'id',
      evolution: ['id', 'messageId', 'key'],
      whatsapp: ['id', 'messageId']
    };

    const fields = idFields[provider.toLowerCase() as keyof typeof idFields];
    
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (payload[field]) return payload[field];
      }
      return null;
    }
    
    return payload[fields as string] || null;
  }

  /**
   * Extract event type for categorization
   */
  private extractEventType(payload: any, provider: string): string {
    const typeFields = {
      stripe: 'type',
      paystack: 'event',
      evolution: 'event',
      whatsapp: 'type'
    };

    const field = typeFields[provider.toLowerCase() as keyof typeof typeFields];
    return payload[field] || 'unknown';
  }

  /**
   * Check for duplicate events
   */
  private async checkDuplicate(eventId: string, provider: string): Promise<{ isDuplicate: boolean }> {
    try {
      const { data, error } = await this.supabase
        .from('webhook_events')
        .select('id')
        .eq('event_id', eventId)
        .eq('provider', provider)
        .limit(1);

      if (error) {
        console.error('Duplicate check error:', error);
        return { isDuplicate: false }; // Fail open for availability
      }

      return { isDuplicate: data && data.length > 0 };
    } catch (error) {
      console.error('Duplicate check exception:', error);
      return { isDuplicate: false };
    }
  }

  /**
   * Rate limiting check
   */
  private checkRateLimit(provider: string): SecurityValidationResult {
    const now = Date.now();
    const windowSize = 60 * 1000; // 1 minute
    const maxRequests = {
      stripe: 100,
      paystack: 50,
      evolution: 200,
      whatsapp: 100
    };

    const limit = maxRequests[provider.toLowerCase() as keyof typeof maxRequests] || 50;
    const cacheKey = `rate_limit:${provider}`;
    const current = this.rateLimitCache.get(cacheKey);

    if (!current || now > current.resetTime) {
      this.rateLimitCache.set(cacheKey, {
        count: 1,
        resetTime: now + windowSize
      });
      return { isValid: true };
    }

    if (current.count >= limit) {
      return { 
        isValid: false, 
        error: `Rate limit exceeded for ${provider}: ${current.count}/${limit}` 
      };
    }

    current.count++;
    return { isValid: true };
  }

  /**
   * Store validated webhook event
   */
  private async storeValidatedEvent(event: WebhookEvent): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('webhook_events')
        .insert({
          event_id: event.id,
          event_type: event.type,
          provider: event.provider,
          signature: event.signature,
          payload: event.payload,
          metadata: event.metadata,
          received_at: new Date().toISOString(),
          processed: false
        });

      if (error) {
        console.error('Failed to store webhook event:', error);
        throw new Error(`Failed to store webhook event: ${error.message}`);
      }
    } catch (error) {
      console.error('Store webhook event exception:', error);
      throw error;
    }
  }

  /**
   * Clean up old webhook events (for maintenance)
   */
  async cleanupOldEvents(retentionDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const { data, error } = await this.supabase
        .from('webhook_events')
        .delete()
        .lt('received_at', cutoffDate.toISOString());

      if (error) {
        throw new Error(`Cleanup failed: ${error.message}`);
      }

      return Array.isArray(data) ? data.length : 0;
    } catch (error) {
      console.error('Cleanup webhook events error:', error);
      throw error;
    }
  }

  /**
   * Get webhook security metrics
   */
  async getSecurityMetrics(timeRange: 'hour' | 'day' | 'week' = 'day') {
    try {
      const now = new Date();
      const startDate = new Date(now);
      
      switch (timeRange) {
        case 'hour':
          startDate.setHours(startDate.getHours() - 1);
          break;
        case 'day':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
      }

      const { data, error } = await this.supabase
        .from('webhook_events')
        .select('provider, event_type, processed, metadata')
        .gte('received_at', startDate.toISOString());

      if (error) {
        throw new Error(`Metrics query failed: ${error.message}`);
      }

      // Process metrics
      const metrics = {
        totalEvents: data?.length || 0,
        byProvider: {} as Record<string, number>,
        byEventType: {} as Record<string, number>,
        processedCount: 0,
        failedCount: 0,
        suspiciousActivity: 0
      };

      data?.forEach(event => {
        metrics.byProvider[event.provider] = (metrics.byProvider[event.provider] || 0) + 1;
        metrics.byEventType[event.event_type] = (metrics.byEventType[event.event_type] || 0) + 1;
        
        if (event.processed) {
          metrics.processedCount++;
        } else {
          metrics.failedCount++;
        }

        // Check for suspicious patterns
        if (event.metadata?.suspicious_flags) {
          metrics.suspiciousActivity++;
        }
      });

      return metrics;
    } catch (error) {
      console.error('Get security metrics error:', error);
      throw error;
    }
  }
}

// ===============================
// WEBHOOK SECURITY MIDDLEWARE
// ===============================

/**
 * Express/Next.js middleware for webhook security
 */
export function createWebhookSecurityMiddleware(provider: string, secretKey: string) {
  const securityService = new WebhookSecurityService();

  return async (req: any, res: any, next: any) => {
    try {
      // Get raw body (ensure it's available)
      const rawBody = req.body || req.rawBody;
      if (!rawBody) {
        return res.status(400).json({ 
          error: 'Missing request body',
          code: 'MISSING_BODY' 
        });
      }

      // Validate webhook security
      const result = await securityService.validateWebhook(
        provider,
        req.headers,
        rawBody,
        secretKey
      );

      if (!result.isValid) {
        return res.status(401).json({
          error: result.error || 'Webhook validation failed',
          code: result.isReplay ? 'REPLAY_ATTACK' : 
                result.rateLimitExceeded ? 'RATE_LIMIT_EXCEEDED' : 
                'VALIDATION_FAILED'
        });
      }

      // Handle duplicate events gracefully
      if (result.isDuplicate) {
        return res.status(200).json({
          message: 'Event already processed',
          eventId: result.eventId,
          code: 'DUPLICATE_EVENT'
        });
      }

      // Add validation result to request for handlers
      req.webhookValidation = result;
      req.eventId = result.eventId;

      next();
    } catch (error) {
      console.error('Webhook security middleware error:', error);
      return res.status(500).json({
        error: 'Internal security validation error',
        code: 'SECURITY_ERROR'
      });
    }
  };
}

// ===============================
// UTILITY FUNCTIONS
// ===============================

/**
 * Read raw body from request (for Next.js API routes)
 */
export async function readRawBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Verify environment secrets are configured
 */
export function validateWebhookSecrets(): {
  isValid: boolean;
  missingSecrets: string[];
  recommendations: string[];
} {
  const requiredSecrets = [
    'STRIPE_WEBHOOK_SECRET',
    'PAYSTACK_WEBHOOK_SECRET', 
    'EVOLUTION_WEBHOOK_SECRET',
    'WHATSAPP_WEBHOOK_SECRET'
  ];

  const missingSecrets: string[] = [];
  const recommendations: string[] = [];

  requiredSecrets.forEach(secret => {
    if (!process.env[secret]) {
      missingSecrets.push(secret);
    }
  });

  if (missingSecrets.length > 0) {
    recommendations.push('Configure missing webhook secrets in environment variables');
    recommendations.push('Use strong, randomly generated secrets for each provider');
    recommendations.push('Store secrets securely (never commit to code)');
  }

  return {
    isValid: missingSecrets.length === 0,
    missingSecrets,
    recommendations
  };
}

/**
 * Generate secure webhook secret
 */
export function generateWebhookSecret(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

export { WebhookSecurityService };