/**
 * Webhook Signature Verification Utilities
 * 
 * Provides simple, direct signature verification functions for:
 * - Stripe (HMAC-SHA256)
 * - Paystack (HMAC-SHA512)
 * 
 * These are lightweight alternatives to the full WebhookSecurityService
 * for use in route handlers where only signature validation is needed.
 */

import crypto from 'crypto';

/**
 * Verify Stripe webhook signature
 * 
 * Stripe uses HMAC-SHA256 with timestamp verification
 * Header format: "t=timestamp,v1=signature"
 * 
 * @param body Raw request body string
 * @param headerSignature The stripe-signature header value
 * @param webhookSecret Stripe webhook secret from dashboard
 * @returns true if signature is valid and timestamp is recent
 */
export function verifyStripeSignature(
  body: string,
  headerSignature: string | undefined | null,
  webhookSecret: string
): boolean {
  if (!headerSignature) {
    console.warn('❌ [Stripe] Missing signature header');
    return false;
  }

  try {
    // Parse header: "t=1614556732,v1=abc123..."
    const parts = headerSignature.split(',');
    let timestamp = '';
    let signature = '';

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') signature = value;
    }

    if (!timestamp || !signature) {
      console.warn('❌ [Stripe] Invalid signature format');
      return false;
    }

    // Verify timestamp is not too old (5 minute tolerance)
    const timestampNum = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    const age = now - timestampNum;

    if (age > 300) {
      console.warn(`❌ [Stripe] Signature too old: ${age} seconds`);
      return false;
    }

    if (age < -60) {
      console.warn(`❌ [Stripe] Signature timestamp in future: ${age} seconds`);
      return false;
    }

    // Reconstruct signed content
    const signedContent = `${timestamp}.${body}`;

    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex');

    // Timing-safe comparison (prevent timing attacks)
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
      
      if (isValid) {
        console.log(`✅ [Stripe] Webhook signature verified`);
      } else {
        console.warn('❌ [Stripe] Signature mismatch');
      }

      return isValid;
    } catch {
      console.warn('❌ [Stripe] Signature comparison failed');
      return false;
    }
  } catch (error) {
    console.error('❌ [Stripe] Error verifying signature:', error);
    return false;
  }
}

/**
 * Verify Paystack webhook signature
 * 
 * Paystack uses HMAC-SHA512
 * Header: x-paystack-signature
 * 
 * @param body Raw request body string
 * @param headerSignature The x-paystack-signature header value
 * @param webhookSecret Paystack secret key from dashboard
 * @returns true if signature is valid
 */
export function verifyPaystackSignature(
  body: string,
  headerSignature: string | undefined | null,
  webhookSecret: string
): boolean {
  if (!headerSignature) {
    console.warn('❌ [Paystack] Missing signature header');
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(body)
      .digest('hex');

    // Timing-safe comparison
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(headerSignature),
        Buffer.from(expectedSignature)
      );

      if (isValid) {
        console.log(`✅ [Paystack] Webhook signature verified`);
      } else {
        console.warn('❌ [Paystack] Signature mismatch');
      }

      return isValid;
    } catch {
      console.warn('❌ [Paystack] Signature comparison failed');
      return false;
    }
  } catch (error) {
    console.error('❌ [Paystack] Error verifying signature:', error);
    return false;
  }
}
