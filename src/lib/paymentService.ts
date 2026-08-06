import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { trace } from '@opentelemetry/api';
import { publishEvent } from './eventBus';
import { observeRequest, refundProcessed, transactionRetried, reconciliationDiscrepancy, depositIdempotencyHit } from './metrics';
import PaymentSecurityService from './paymentSecurityService';
import crypto from 'crypto';
import { fetchWithTimeout } from './fetchWithTimeout';

// All payment provider API calls use fetchWithTimeout to prevent indefinite hangs
const PAYMENT_TIMEOUT_MS = 15_000;

export interface PaymentProvider {
  id: string;
  name: string;
  initializePayment(params: InitializePaymentParams): Promise<PaymentResponse>;
  verifyPayment(reference: string): Promise<VerificationResponse>;
  refundPayment(params: RefundParams): Promise<RefundResponse>;
  getTransactionStatus(reference: string): Promise<TransactionStatusResponse>;
}

export interface InitializePaymentParams {
  amount: number;
  currency: string;
  email: string;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  subaccountCode?: string;           // tenant's Paystack subaccount (e.g. ACCT_xxxx)
  bearer?: 'account' | 'subaccount'; // who bears Paystack fee; default 'account'
}

export interface PaymentResponse {
  success: boolean;
  reference: string;
  authorizationUrl?: string;
  accessCode?: string;
  error?: string;
}

export interface VerificationResponse {
  success: boolean;
  status: string;
  amount: number;
  currency: string;
  paidAt?: string;
  reference: string;
  providerReference?: string;
  error?: string;
}

export interface RefundParams {
  transactionReference: string;
  amount?: number; // partial refund if specified
  reason?: string;
}

export interface RefundResponse {
  success: boolean;
  refundReference: string;
  amount: number;
  error?: string;
}

export interface TransactionStatusResponse {
  status: string;
  amount: number;
  currency: string;
  reference: string;
  providerReference?: string;
}

// Paystack provider implementation
class PaystackProvider implements PaymentProvider {
  id = 'paystack';
  name = 'Paystack';
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentResponse> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('paystack.initialize_payment');
    
    try {
      const response = await fetchWithTimeout('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: params.amount * 100, // Convert to kobo
          currency: params.currency,
          email: params.email,
          reference: params.reference,
          callback_url: params.callbackUrl,
          metadata: params.metadata,
          ...(params.subaccountCode && {
            subaccount: params.subaccountCode,
            bearer: params.bearer ?? 'account',
          }),
        }),
      });

      const data = await response.json();
      span.setAttribute('paystack.status', data.status);

      if (data.status) {
        return {
          success: true,
          reference: params.reference,
          authorizationUrl: data.data.authorization_url,
          accessCode: data.data.access_code,
        };
      } else {
        return {
          success: false,
          reference: params.reference,
          error: data.message || 'Payment initialization failed',
        };
      }
    } catch (error) {
      span.recordException(error as Error);
      return {
        success: false,
        reference: params.reference,
        error: `Network error: ${(error as Error).message}`,
      };
    } finally {
      span.end();
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('paystack.verify_payment');
    span.setAttribute('payment.reference', reference);

    try {
      const response = await fetchWithTimeout(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
        },
      });

      const data = await response.json();
      span.setAttribute('paystack.status', data.status);

      if (data.status) {
        const transaction = data.data;
        return {
          success: true,
          status: transaction.status,
          amount: transaction.amount / 100, // Convert from kobo
          currency: transaction.currency,
          paidAt: transaction.paid_at,
          reference: transaction.reference,
          providerReference: transaction.id?.toString(),
        };
      } else {
        return {
          success: false,
          status: 'failed',
          amount: 0,
          currency: 'NGN',
          reference,
          error: data.message || 'Verification failed',
        };
      }
    } catch (error) {
      span.recordException(error as Error);
      return {
        success: false,
        status: 'error',
        amount: 0,
        currency: 'NGN',
        reference,
        error: `Network error: ${(error as Error).message}`,
      };
    } finally {
      span.end();
    }
  }

  async refundPayment(params: RefundParams): Promise<RefundResponse> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('paystack.refund_payment');
    
    try {
      const body: Record<string, unknown> = {
        transaction: params.transactionReference,
      };
      
      if (params.amount) {
        body.amount = params.amount * 100; // Convert to kobo
      }

      const response = await fetchWithTimeout('https://api.paystack.co/refund', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      span.setAttribute('paystack.status', data.status);

      if (data.status) {
        return {
          success: true,
          refundReference: data.data.transaction?.reference || `refund_${Date.now()}`,
          amount: (data.data.amount || 0) / 100,
        };
      } else {
        return {
          success: false,
          refundReference: '',
          amount: 0,
          error: data.message || 'Refund failed',
        };
      }
    } catch (error) {
      span.recordException(error as Error);
      return {
        success: false,
        refundReference: '',
        amount: 0,
        error: `Network error: ${(error as Error).message}`,
      };
    } finally {
      span.end();
    }
  }

  async getTransactionStatus(reference: string): Promise<TransactionStatusResponse> {
    const verification = await this.verifyPayment(reference);
    return {
      status: verification.status,
      amount: verification.amount,
      currency: verification.currency,
      reference: verification.reference,
      providerReference: verification.providerReference,
    };
  }
}

// Stripe provider implementation
class StripeProvider implements PaymentProvider {
  id = 'stripe';
  name = 'Stripe';
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  private get authHeader() {
    return `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`;
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentResponse> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('stripe.initialize_payment');

    try {
      // Create a PaymentIntent
      const body = new URLSearchParams({
        amount: String(Math.round(params.amount * 100)), // Convert to cents
        currency: params.currency.toLowerCase(),
        'metadata[reference]': params.reference,
        'metadata[tenant_id]': String(params.metadata?.tenant_id || ''),
        'metadata[reservation_id]': String(params.metadata?.reservation_id || ''),
      });

      if (params.callbackUrl) {
        body.append('return_url', params.callbackUrl);
      }

      const response = await fetchWithTimeout('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': params.reference,
        },
        body,
      });

      const data = await response.json();
      span.setAttribute('stripe.status', response.status);

      if (!response.ok) {
        return { success: false, reference: params.reference, error: data.error?.message || 'Payment initialization failed' };
      }

      return {
        success: true,
        reference: params.reference,
        authorizationUrl: `${params.callbackUrl || ''}?payment_intent=${data.id}&client_secret=${data.client_secret}`,
        accessCode: data.client_secret,
      };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, reference: params.reference, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('stripe.verify_payment');
    span.setAttribute('payment.reference', reference);

    try {
      // Search for PaymentIntent by metadata reference (reference is URL-encoded to prevent injection)
      const response = await fetchWithTimeout(
        `https://api.stripe.com/v1/payment_intents/search?query=metadata['reference']:'${encodeURIComponent(reference)}'`,
        { headers: { Authorization: this.authHeader }, timeoutMs: PAYMENT_TIMEOUT_MS }
      );

      const data = await response.json();

      if (!response.ok || !data.data?.length) {
        return { success: false, status: 'failed', amount: 0, currency: 'USD', reference, error: data.error?.message || 'Payment not found' };
      }

      const intent = data.data[0];
      const statusMap: Record<string, string> = {
        succeeded: 'success',
        requires_payment_method: 'pending',
        requires_confirmation: 'pending',
        processing: 'pending',
        canceled: 'failed',
      };

      return {
        success: intent.status === 'succeeded',
        status: statusMap[intent.status] || intent.status,
        amount: intent.amount_received / 100,
        currency: intent.currency.toUpperCase(),
        paidAt: intent.created ? new Date(intent.created * 1000).toISOString() : undefined,
        reference,
        providerReference: intent.id,
      };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, status: 'error', amount: 0, currency: 'USD', reference, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  async refundPayment(params: RefundParams): Promise<RefundResponse> {
    const tracer = trace.getTracer('boka');
    const span = tracer.startSpan('stripe.refund_payment');

    try {
      const body = new URLSearchParams({
        payment_intent: params.transactionReference,
      });
      if (params.amount) {
        body.append('amount', String(Math.round(params.amount * 100)));
      }
      if (params.reason) {
        body.append('reason', 'requested_by_customer');
        body.append('metadata[reason]', params.reason);
      }

      const response = await fetchWithTimeout('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: { Authorization: this.authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      const data = await response.json();
      span.setAttribute('stripe.status', response.status);

      if (!response.ok) {
        return { success: false, refundReference: '', amount: 0, error: data.error?.message || 'Refund failed' };
      }

      return {
        success: data.status === 'succeeded' || data.status === 'pending',
        refundReference: data.id,
        amount: data.amount / 100,
      };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, refundReference: '', amount: 0, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  async getTransactionStatus(reference: string): Promise<TransactionStatusResponse> {
    const verification = await this.verifyPayment(reference);
    return {
      status: verification.status,
      amount: verification.amount,
      currency: verification.currency,
      reference: verification.reference,
      providerReference: verification.providerReference,
    };
  }
}

// Flutterwave provider implementation
class FlutterwaveProvider implements PaymentProvider {
  id = 'flutterwave';
  name = 'Flutterwave';
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentResponse> {
    const res = await fetchWithTimeout('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: params.reference,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.callbackUrl,
        customer: { email: params.email },
        meta: params.metadata,
      }),
    });
    const data = await res.json();
    return {
      success: data.status === 'success',
      reference: params.reference,
      authorizationUrl: data.data?.link,
      error: data.status !== 'success' ? data.message : undefined,
    };
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    const res = await fetchWithTimeout(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { 'Authorization': `Bearer ${this.secretKey}` }, timeoutMs: PAYMENT_TIMEOUT_MS }
    );
    const data = await res.json();
    const tx = data.data;
    return {
      success: data.status === 'success' && tx?.status === 'successful',
      status: tx?.status ?? 'unknown',
      amount: tx?.amount ?? 0,
      currency: tx?.currency ?? '',
      paidAt: tx?.created_at,
      reference,
      providerReference: String(tx?.id ?? ''),
      error: data.status !== 'success' ? data.message : undefined,
    };
  }

  async refundPayment(params: RefundParams): Promise<RefundResponse> {
    const res = await fetchWithTimeout(`https://api.flutterwave.com/v3/transactions/${params.transactionReference}/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: params.amount }),
    });
    const data = await res.json();
    return {
      success: data.status === 'success',
      refundReference: data.data?.id ? String(data.data.id) : params.transactionReference,
      amount: data.data?.amount ?? params.amount ?? 0,
      error: data.status !== 'success' ? data.message : undefined,
    };
  }

  async getTransactionStatus(reference: string): Promise<TransactionStatusResponse> {
    const res = await fetchWithTimeout(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { 'Authorization': `Bearer ${this.secretKey}` }, timeoutMs: PAYMENT_TIMEOUT_MS }
    );
    const data = await res.json();
    const tx = data.data;
    return {
      status: tx?.status ?? 'unknown',
      amount: tx?.amount ?? 0,
      currency: tx?.currency ?? '',
      reference,
      providerReference: String(tx?.id ?? ''),
    };
  }
}

export class PaymentService {
  private supabase: SupabaseClient;
  private providers: Map<string, PaymentProvider> = new Map();
  private tracer = trace.getTracer('boka');
  private securityService: PaymentSecurityService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.securityService = new PaymentSecurityService(supabase);
    this.initializeProviders();
  }

  private initializeProviders() {
    if (process.env.PAYSTACK_SECRET_KEY) {
      this.providers.set('paystack', new PaystackProvider(process.env.PAYSTACK_SECRET_KEY));
    }
    if (process.env.STRIPE_SECRET_KEY) {
      this.providers.set('stripe', new StripeProvider(process.env.STRIPE_SECRET_KEY));
    }
    if (process.env.FLUTTERWAVE_SECRET_KEY) {
      this.providers.set('flutterwave', new FlutterwaveProvider(process.env.FLUTTERWAVE_SECRET_KEY));
    }
  }

  async initializePayment(params: {
    tenantId: string;
    amount: number;
    currency: string;
    email: string;
    reservationId?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    subaccountCode?: string;
    bearer?: 'account' | 'subaccount';
    callbackUrl?: string;
  }): Promise<{
    success: boolean;
    transactionId?: string;
    authorizationUrl?: string;
    error?: string;
    requiresReview?: boolean;
    riskScore?: number;
  }> {
    const span = this.tracer.startSpan('payment.initialize');
    const start = Date.now();

    try {
      // Enhanced idempotency and fraud detection
      const idempotencyKey = `payment:${params.provider || 'paystack'}:${params.tenantId}:${params.reservationId || 'direct'}:${params.amount}`;
      
      const securityCheck = await this.securityService.checkIdempotency(
        'payment',
        idempotencyKey,
        params.tenantId,
        params.amount,
        {
          email: params.email,
          ip_address: params.ipAddress,
          user_agent: params.userAgent,
          currency: params.currency,
          payment_method: params.provider || 'paystack',
          ...params.metadata,
        }
      );

      // If idempotent, return existing transaction
      if (securityCheck.isIdempotent && securityCheck.existingTransaction) {
        depositIdempotencyHit(params.tenantId);
        return {
          success: true,
          transactionId: securityCheck.existingTransaction.transaction_id,
          authorizationUrl: securityCheck.existingTransaction.authorization_url,
        };
      }

      // Check fraud assessment
      if (securityCheck.fraud_assessment) {
        const assessment = securityCheck.fraud_assessment;
        
        if (assessment.recommendation === 'decline') {
          return {
            success: false,
            error: 'Payment declined due to security concerns',
            requiresReview: false,
            riskScore: assessment.risk_score,
          };
        }

        if (assessment.recommendation === 'review') {
          return {
            success: false,
            error: 'Payment requires manual review',
            requiresReview: true,
            riskScore: assessment.risk_score,
          };
        }
      }

      const provider = this.getProvider(params.provider || 'paystack');
      if (!provider) {
        return { success: false, error: 'Payment provider not configured' };
      }

      const reference = this.generateReference();

      // Insert pending record BEFORE calling provider to prevent zombie payments:
      // if the provider call succeeds but the DB insert fails, the payment has no
      // local record and can never be reconciled.
      const { data: transaction, error: insertError } = await this.supabase
        .from('transactions')
        .insert({
          tenant_id: params.tenantId,
          amount: params.amount,
          currency: params.currency,
          type: 'deposit',
          status: 'pending',
          provider_reference: reference,
          // reservations is the payment subject; the webhook confirms via subject_id.
          subject_type: params.reservationId ? 'reservation' : null,
          subject_id: params.reservationId ?? null,
          // transactions has no `provider` column — provider/email live in raw.
          raw: {
            ref: reference,
            email: params.email,
            reservation_id: params.reservationId,
            provider: provider.id,
          },
        })
        .select('id')
        .single();

      if (insertError) {
        span.recordException(new Error(insertError.message));
        return { success: false, error: insertError.message };
      }

      const response = await provider.initializePayment({
        amount: params.amount,
        currency: params.currency,
        email: params.email,
        reference,
        metadata: {
          tenant_id: params.tenantId,
          reservation_id: params.reservationId,
          ...params.metadata,
        },
        subaccountCode: params.subaccountCode,
        bearer: params.bearer,
        callbackUrl: params.callbackUrl,
      });

      // Update the record with provider response (non-fatal if this fails — record is reconcilable)
      await this.supabase
        .from('transactions')
        .update({
          status: response.success ? 'pending' : 'failed',
          raw: {
            ref: reference,
            email: params.email,
            reservation_id: params.reservationId,
            provider: provider.id,
            provider_response: response,
          },
        })
        .eq('id', transaction.id);

      // Create initial ledger entry
      await this.createLedgerEntry({
        tenantId: params.tenantId,
        transactionId: transaction.id,
        entryType: 'deposit',
        amount: params.amount,
        currency: params.currency,
        description: `Deposit initialization for reservation ${params.reservationId}`,
        referenceId: reference,
      });

      span.setAttribute('payment.success', response.success);
      span.setAttribute('payment.reference', reference);

      if (response.success) {
        await publishEvent({
          supabase: this.supabase,
          event: 'payment.initialized',
          payload: {
            transaction_id: transaction.id,
            reference,
            amount: params.amount,
            currency: params.currency,
            authorization_url: response.authorizationUrl,
          },
          tenantId: params.tenantId,
        });
      }

      return {
        success: response.success,
        transactionId: transaction.id,
        authorizationUrl: response.authorizationUrl,
        error: response.error,
      };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      const duration = (Date.now() - start) / 1000;
      observeRequest('/api/payments/initialize', 'POST', 200, duration);
      span.end();
    }
  }

  async processRefund(params: {
    tenantId: string;
    transactionId: string;
    amount?: number;
    reason?: string;
  }): Promise<{ success: boolean; refundId?: string; error?: string }> {
    const span = this.tracer.startSpan('payment.refund');
    
    try {
      // Get original transaction
      const { data: transaction, error: fetchError } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('id', params.transactionId)
        .eq('tenant_id', params.tenantId)
        .single();

      if (fetchError || !transaction) {
        return { success: false, error: 'Transaction not found' };
      }

      const providerId = (transaction.raw as { provider?: string } | null)?.provider;
      const provider = this.getProvider(providerId);
      if (!provider) {
        return { success: false, error: 'Payment provider not available' };
      }

      const refundAmount = params.amount || transaction.amount;

      // Pre-insert a pending refund record BEFORE calling the provider.
      // This ensures we always have a local record even if the provider succeeds but the
      // subsequent DB update fails — preventing untracked refunds.
      const { data: pendingRefund, error: pendingRefundError } = await this.supabase
        .from('transactions')
        .insert({
          tenant_id: params.tenantId,
          original_transaction_id: params.transactionId,
          amount: -refundAmount,
          currency: transaction.currency,
          type: 'refund',
          status: 'pending',
          subject_type: transaction.subject_type ?? null,
          subject_id: transaction.subject_id ?? null,
          refund_amount: refundAmount,
          refund_reason: params.reason,
          // transactions has no `provider` column — it lives in raw.
          raw: { original_reference: transaction.provider_reference, provider: (transaction.raw as { provider?: string } | null)?.provider ?? null },
        })
        .select('id')
        .single();

      if (pendingRefundError) {
        span.recordException(new Error(pendingRefundError.message));
        return { success: false, error: `Failed to create pending refund record: ${pendingRefundError.message}` };
      }

      const refundResponse = await provider.refundPayment({
        transactionReference: transaction.provider_reference,
        amount: refundAmount,
        reason: params.reason,
      });

      if (!refundResponse.success) {
        // Mark the pre-inserted record as failed
        await this.supabase
          .from('transactions')
          .update({
            status: 'failed',
            raw: {
              original_reference: transaction.provider_reference,
              provider: provider.id,
              refund_response: refundResponse,
            },
          })
          .eq('id', pendingRefund.id);
        refundProcessed(params.tenantId, 'failed');
        return { success: false, error: refundResponse.error };
      }

      refundProcessed(params.tenantId, 'success', refundAmount);

      // Update the pre-inserted record to completed with provider reference
      const { data: refundTransaction, error: refundError } = await this.supabase
        .from('transactions')
        .update({
          status: 'completed',
          provider_reference: refundResponse.refundReference,
          raw: {
            original_reference: transaction.provider_reference,
            provider: provider.id,
            refund_response: refundResponse,
          },
        })
        .eq('id', pendingRefund.id)
        .select('id')
        .single();

      if (refundError) {
        // Provider refund succeeded but DB update failed — log as critical for reconciliation
        span.recordException(new Error(refundError.message));
        defaultLogger.error('[paymentService] CRITICAL: Provider refund succeeded but DB update failed — reconciliation required', {
          pendingRefundId: pendingRefund.id,
          providerReference: refundResponse.refundReference,
          error: refundError.message,
        });
        return { success: false, error: refundError.message };
      }

      // Create refund ledger entry
      await this.createLedgerEntry({
        tenantId: params.tenantId,
        transactionId: refundTransaction.id,
        entryType: 'refund',
        amount: -refundAmount,
        currency: transaction.currency,
        description: `Refund: ${params.reason || 'No reason provided'}`,
        referenceId: refundResponse.refundReference,
      });

      // Publish refund event
      await publishEvent({
        supabase: this.supabase,
        event: 'payment.refunded',
        payload: {
          original_transaction_id: params.transactionId,
          refund_transaction_id: refundTransaction.id,
          refund_amount: refundAmount,
          reason: params.reason,
        },
        tenantId: params.tenantId,
      });

      return { success: true, refundId: refundTransaction.id };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  async retryFailedTransaction(transactionId: string): Promise<{ success: boolean; error?: string }> {
    const span = this.tracer.startSpan('payment.retry');
    
    try {
      // Get transaction details
      const { data: transaction, error } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .single();

      if (error || !transaction) {
        return { success: false, error: 'Transaction not found' };
      }

      if (transaction.retry_count >= 3) {
        return { success: false, error: 'Maximum retry attempts exceeded' };
      }

      const provider = this.getProvider((transaction.raw as { provider?: string } | null)?.provider);
      if (!provider) {
        return { success: false, error: 'Payment provider not available' };
      }

      // Record retry attempt
      await this.supabase.from('transaction_retries').insert({
        transaction_id: transactionId,
        attempt_number: transaction.retry_count + 1,
        status: 'pending',
      });

      // Get current status from provider
      const statusResponse = await provider.getTransactionStatus(transaction.provider_reference);
      
      // Update transaction with new status
      const updateData: Record<string, unknown> = {
        status: statusResponse.status,
        retry_count: transaction.retry_count + 1,
        last_retry_at: new Date().toISOString(),
      };

      if (statusResponse.status === 'failed') {
        // Schedule next retry (exponential backoff: 5min, 15min, 45min)
        const backoffMinutes = Math.pow(3, transaction.retry_count) * 5;
        updateData.next_retry_at = new Date(Date.now() + backoffMinutes * 60000).toISOString();
      } else if (statusResponse.status === 'success') {
        updateData.next_retry_at = null;
      }

      await this.supabase
        .from('transactions')
        .update(updateData)
        .eq('id', transactionId);

      // Update retry record
      await this.supabase
        .from('transaction_retries')
        .update({
          status: statusResponse.status === 'success' ? 'success' : 'failed',
          response_data: statusResponse,
          next_attempt_at: updateData.next_retry_at,
        })
        .eq('transaction_id', transactionId)
        .eq('attempt_number', transaction.retry_count + 1);

      const isSuccess = statusResponse.status === 'success';
      transactionRetried(transaction.tenant_id, isSuccess ? 'success' : 'failed');

      return { success: isSuccess };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  async reconcileLedger(tenantId: string, date?: string): Promise<{ success: boolean; discrepancies?: unknown[]; error?: string }> {
    const span = this.tracer.startSpan('payment.reconcile_ledger');
    
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      
      // Get all transactions for the date
      const { data: transactions, error } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', `${targetDate}T00:00:00.000Z`)
        .lt('created_at', `${targetDate}T23:59:59.999Z`)
        .neq('reconciliation_status', 'matched');

      if (error) {
        return { success: false, error: error.message };
      }

      const discrepancies = [];

      for (const transaction of transactions || []) {
        if (!transaction.provider_reference) continue;

        const provider = this.getProvider((transaction.raw as { provider?: string } | null)?.provider);
        if (!provider) continue;

        try {
          const statusResponse = await provider.getTransactionStatus(transaction.provider_reference);
          
          let reconciliationStatus = 'matched';
          
          // Check for discrepancies
          if (Math.abs(statusResponse.amount - Math.abs(transaction.amount)) > 0.01) {
            reconciliationStatus = 'discrepancy';
            reconciliationDiscrepancy(tenantId, 'amount_mismatch');
            discrepancies.push({
              transaction_id: transaction.id,
              type: 'amount_mismatch',
              expected: transaction.amount,
              actual: statusResponse.amount,
            });
          }

          if (statusResponse.status !== transaction.status) {
            reconciliationStatus = 'discrepancy';
            reconciliationDiscrepancy(tenantId, 'status_mismatch');
            discrepancies.push({
              transaction_id: transaction.id,
              type: 'status_mismatch', 
              expected: transaction.status,
              actual: statusResponse.status,
            });
          }

          // Update reconciliation status
          await this.supabase
            .from('transactions')
            .update({
              reconciliation_status: reconciliationStatus,
              reconciled_at: reconciliationStatus === 'matched' ? new Date().toISOString() : null,
            })
            .eq('id', transaction.id);

        } catch (providerError) {
          reconciliationDiscrepancy(tenantId, 'provider_error');
          discrepancies.push({
            transaction_id: transaction.id,
            type: 'provider_error',
            error: (providerError as Error).message,
          });
        }
      }

      return { success: true, discrepancies };
    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  private async createLedgerEntry(params: {
    tenantId: string;
    transactionId: string;
    entryType: 'deposit' | 'refund' | 'fee' | 'adjustment';
    amount: number;
    currency: string;
    description: string;
    referenceId: string;
  }) {
    await this.supabase.from('ledger_entries').insert({
      tenant_id: params.tenantId,
      transaction_id: params.transactionId,
      entry_type: params.entryType,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      reference_id: params.referenceId,
    });
  }

  private getProvider(providerId?: string): PaymentProvider | undefined {
    return providerId ? this.providers.get(providerId) : undefined;
  }

  private generateReference(): string {
    return `boka_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }
}

export default PaymentService;
