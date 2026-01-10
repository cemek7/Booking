import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace } from '@opentelemetry/api';
import { publishEvent } from './eventBus';
import { observeRequest, refundProcessed, transactionRetried, reconciliationDiscrepancy, depositIdempotencyHit } from './metrics';
import PaymentSecurityService from './paymentSecurityService';
import crypto from 'crypto';

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
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
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
      const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
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

      const response = await fetch('https://api.paystack.co/refund', {
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

// Stripe provider stub
class StripeProvider implements PaymentProvider {
  id = 'stripe';
  name = 'Stripe';
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentResponse> {
    // Stripe implementation would go here
    return {
      success: false,
      reference: params.reference,
      error: 'Stripe integration not implemented yet',
    };
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    return {
      success: false,
      status: 'failed',
      amount: 0,
      currency: 'USD',
      reference,
      error: 'Stripe integration not implemented yet',
    };
  }

  async refundPayment(): Promise<RefundResponse> {
    return {
      success: false,
      refundReference: '',
      amount: 0,
      error: 'Stripe integration not implemented yet',
    };
  }

  async getTransactionStatus(reference: string): Promise<TransactionStatusResponse> {
    return {
      status: 'failed',
      amount: 0,
      currency: 'USD',
      reference,
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
      const idempotencyKey = `payment:${params.tenantId}:${params.reservationId || 'direct'}:${params.amount}:${params.email}`;
      
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
      });

      // Create transaction record
      const { data: transaction, error } = await this.supabase
        .from('transactions')
        .insert({
          tenant_id: params.tenantId,
          amount: params.amount,
          currency: params.currency,
          type: 'deposit',
          status: 'pending',
          provider: provider.id,
          provider_reference: reference,
          raw: {
            ref: reference,
            email: params.email,
            reservation_id: params.reservationId,
            provider_response: response,
          },
        })
        .select('id')
        .single();

      if (error) {
        span.recordException(new Error(error.message));
        return { success: false, error: error.message };
      }

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
          tenant_id: params.tenantId,
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

      const provider = this.getProvider(transaction.provider);
      if (!provider) {
        return { success: false, error: 'Payment provider not available' };
      }

      const refundAmount = params.amount || transaction.amount;
      
      const refundResponse = await provider.refundPayment({
        transactionReference: transaction.provider_reference,
        amount: refundAmount,
        reason: params.reason,
      });

      if (!refundResponse.success) {
        refundProcessed(params.tenantId, 'failed');
        return { success: false, error: refundResponse.error };
      }

      refundProcessed(params.tenantId, 'success', refundAmount);

      // Create refund transaction record
      const { data: refundTransaction, error: refundError } = await this.supabase
        .from('transactions')
        .insert({
          tenant_id: params.tenantId,
          original_transaction_id: params.transactionId,
          amount: -refundAmount, // Negative amount for refund
          currency: transaction.currency,
          type: 'refund',
          status: 'completed',
          provider: transaction.provider,
          provider_reference: refundResponse.refundReference,
          refund_amount: refundAmount,
          refund_reason: params.reason,
          raw: {
            original_reference: transaction.provider_reference,
            refund_response: refundResponse,
          },
        })
        .select('id')
        .single();

      if (refundError) {
        span.recordException(new Error(refundError.message));
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
        tenant_id: params.tenantId,
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

      const provider = this.getProvider(transaction.provider);
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

        const provider = this.getProvider(transaction.provider);
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

  private getProvider(providerId: string): PaymentProvider | undefined {
    return this.providers.get(providerId);
  }

  private generateReference(): string {
    return `boka_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }
}

export default PaymentService;