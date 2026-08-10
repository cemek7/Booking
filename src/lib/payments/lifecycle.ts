/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultLogger } from '@/lib/logger';
/**
 * Payments Lifecycle Management - Production Ready
 * 
 * Comprehensive payment processing system including:
 * - Multi-provider payment processing (Stripe, Paystack)
 * - Payment lifecycle management (pending, completed, failed, refunded)
 * - Automatic retry mechanisms and dead letter queues
 * - Ledger reconciliation and financial integrity
 * - Fraud detection and prevention
 * - PCI compliance utilities
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { getEventBus } from '../eventbus/eventBus';
import { recordFrontDeskEvent } from '@/lib/ai/front-desk-events';

// ===============================
// PAYMENT SCHEMAS & TYPES
// ===============================

export const PaymentProviders = ['stripe', 'paystack', 'flutterwave'] as const;
export type PaymentProvider = typeof PaymentProviders[number];

export const PaymentMethods = ['card', 'bank_transfer', 'mobile_money', 'crypto'] as const;
export type PaymentMethod = typeof PaymentMethods[number];

export const PaymentStatuses = [
  'pending',
  'processing', 
  'completed',
  'failed',
  'cancelled',
  'refunded',
  'disputed',
  'expired'
] as const;
export type PaymentStatus = typeof PaymentStatuses[number];

export const TransactionTypes = [
  'payment',
  'refund', 
  'partial_refund',
  'chargeback',
  'fee',
  'adjustment',
  'transfer'
] as const;
export type TransactionType = typeof TransactionTypes[number];

const CreatePaymentSchema = z.object({
  bookingId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  provider: z.enum(PaymentProviders),
  method: z.enum(PaymentMethods),
  customerId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional()
});

const RefundRequestSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(), // If not provided, full refund
  reason: z.string().min(5),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreatePaymentRequest = z.infer<typeof CreatePaymentSchema>;
export type RefundRequest = z.infer<typeof RefundRequestSchema>;

// ===============================
// PAYMENT LIFECYCLE SERVICE
// ===============================

export class PaymentLifecycleService {
  private supabase;
  private eventBus;
  
  constructor() {
    this.supabase = createServerSupabaseClient();
    this.eventBus = getEventBus();
  }

  // ===============================
  // PAYMENT CREATION & PROCESSING
  // ===============================

  /**
   * Create payment intent with provider
   */
  async createPayment(request: CreatePaymentRequest, tenantId: string): Promise<{
    paymentId: string;
    clientSecret?: string;
    paymentUrl?: string;
    providerPaymentId: string;
  }> {
    try {
      // Validate request
      const validatedRequest = CreatePaymentSchema.parse(request);
      
      // Verify reservation exists and belongs to tenant
      const booking = await this.verifyReservation(validatedRequest.bookingId, tenantId);
      
      // Check for existing pending payment
      const existingPayment = await this.checkExistingPayment(validatedRequest.bookingId);
      if (existingPayment) {
        throw new Error(`Payment already exists for reservation: ${existingPayment.id}`);
      }

      // Create provider-specific payment
      const providerResult = await this.createProviderPayment(validatedRequest, booking, tenantId);
      
      // Create transaction record
      const transaction = await this.createTransaction({
        bookingId: validatedRequest.bookingId,
        tenantId,
        amount: validatedRequest.amount,
        currency: validatedRequest.currency,
        type: 'payment',
        status: 'pending',
        provider: validatedRequest.provider,
        providerTransactionId: providerResult.providerPaymentId,
        paymentMethod: validatedRequest.method,
        metadata: {
          ...validatedRequest.metadata,
          providerData: providerResult.providerData
        }
      });

      // Publish payment created event
      await this.eventBus.publishEvent(
        validatedRequest.bookingId,
        'booking',
        'payment.created',
        {
          paymentId: transaction.id,
          amount: validatedRequest.amount,
          currency: validatedRequest.currency,
          provider: validatedRequest.provider
        },
        { tenantId }
      );

      return {
        paymentId: transaction.id,
        clientSecret: providerResult.clientSecret,
        paymentUrl: providerResult.paymentUrl,
        providerPaymentId: providerResult.providerPaymentId
      };

    } catch (error) {
      defaultLogger.error('Error creating payment:', error);
      throw error;
    }
  }

  /**
   * Payment tracking for ops: live (pending/processing), hanging (live but
   * stuck older than `staleMinutes`), and failed transactions for a tenant.
   * Read-only; uses the real transactions schema.
   */
  async getPaymentTracking(
    tenantId: string,
    opts?: { staleMinutes?: number; limit?: number }
  ): Promise<{ live: any[]; hanging: any[]; failed: any[] }> {
    const staleMinutes = opts?.staleMinutes ?? 30;
    const staleBefore = new Date(Date.now() - staleMinutes * 60_000).toISOString();

    const { data, error } = await this.supabase
      .from('transactions')
      .select('id, amount, currency, type, status, provider_reference, subject_id, subject_type, created_at, updated_at, raw')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 500);

    if (error) {
      throw new Error(`Failed to load payment tracking: ${error.message}`);
    }

    const rows = data ?? [];
    const live = rows.filter((t) => t.status === 'pending' || t.status === 'processing');
    return {
      live,
      hanging: live.filter((t) => (t.created_at ?? '') < staleBefore),
      failed: rows.filter((t) => t.status === 'failed'),
    };
  }

  /**
   * Process payment completion from webhook
   */
  async processPaymentCompleted(
    providerPaymentId: string,
    provider: PaymentProvider,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    try {
      // Find transaction by provider payment ID
      const { data: transaction, error } = await this.supabase
        .from('transactions')
        .select('*, reservation:reservations(*)')
        .eq('provider_reference', providerPaymentId)
        .single();

      if (error || !transaction) {
        throw new Error(`Transaction not found for provider payment: ${providerPaymentId}`);
      }

      if (transaction.status === 'completed') {
        defaultLogger.info(`Payment already completed: ${transaction.id}`);
        return;
      }

      // Update transaction status
      await this.updateTransactionStatus(transaction.id, 'completed', {
        completedAt: new Date().toISOString(),
        providerMetadata: metadata
      });

      // Confirm reservation after successful payment (subject_id = reservation id)
      await this.supabase
        .from('reservations')
        .update({
          // reservations has no updated_at column.
          status: 'confirmed'
        })
        .eq('id', transaction.subject_id);

      // Record in ledger
      await this.recordLedgerEntry({
        transactionId: transaction.id,
        tenantId: transaction.tenant_id,
        debitAccount: 'customer_payments',
        creditAccount: 'revenue',
        amount: transaction.amount,
        currency: transaction.currency,
        description: `Payment completed for reservation ${transaction.subject_id}`
      });

      // Publish payment completed event
      await this.eventBus.publishEvent(
        transaction.subject_id,
        'booking',
        'payment.completed',
        {
          paymentId: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          provider: (transaction.raw as any)?.provider ?? provider,
          providerPaymentId
        },
        { tenantId: transaction.tenant_id }
      );

      defaultLogger.info(`Payment completed: ${transaction.id}`);

    } catch (error) {
      defaultLogger.error('Error processing payment completion:', error);
      throw error;
    }
  }

  /**
   * Process payment failure from webhook
   */
  async processPaymentFailed(
    providerPaymentId: string,
    provider: PaymentProvider,
    failureReason: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    try {
      const { data: transaction, error } = await this.supabase
        .from('transactions')
        .select('*, reservation:reservations(notes)')
        .eq('provider_reference', providerPaymentId)
        .single();

      if (error || !transaction) {
        throw new Error(`Transaction not found for failed payment: ${providerPaymentId}`);
      }

      // Update transaction status
      await this.updateTransactionStatus(transaction.id, 'failed', {
        failureReason,
        failedAt: new Date().toISOString(),
        providerMetadata: metadata
      });

      // Mark reservation payment failure on the canonical reservations table
      await this.supabase
        .from('reservations')
        .update({
          status: 'payment_failed',
          notes: (transaction.reservation?.notes || '') + `\nPayment failed: ${failureReason}`
        })
        .eq('id', transaction.subject_id);

      // Publish payment failed event
      await this.eventBus.publishEvent(
        transaction.subject_id,
        'booking',
        'payment.failed',
        {
          paymentId: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          provider: (transaction.raw as any)?.provider ?? provider,
          failureReason
        },
        { tenantId: transaction.tenant_id }
      );

      // Check if automatic retry is appropriate
      await this.evaluatePaymentRetry(transaction);

    } catch (error) {
      defaultLogger.error('Error processing payment failure:', error);
      throw error;
    }
  }

  // ===============================
  // REFUND MANAGEMENT
  // ===============================

  /**
   * Process refund request
   */
  async processRefund(request: RefundRequest, tenantId: string): Promise<{
    refundId: string;
    status: string;
    providerRefundId?: string;
  }> {
    try {
      const validatedRequest = RefundRequestSchema.parse(request);
      
      // Get original transaction
      const { data: originalTransaction, error } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('id', validatedRequest.transactionId)
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .single();

      if (error || !originalTransaction) {
        throw new Error(`Transaction not found or not eligible for refund: ${validatedRequest.transactionId}`);
      }

      const refundAmount = validatedRequest.amount || originalTransaction.amount;
      
      // Validate refund amount
      const totalRefunded = await this.getTotalRefunded(originalTransaction.id);
      if (totalRefunded + refundAmount > originalTransaction.amount) {
        throw new Error(`Refund amount exceeds available balance. Available: ${originalTransaction.amount - totalRefunded}`);
      }

      // Create provider refund
      const providerRefundResult = await this.createProviderRefund(
        originalTransaction,
        refundAmount,
        validatedRequest.reason
      );

      // Create refund transaction
      const refundTransaction = await this.createTransaction({
        bookingId: originalTransaction.subject_id,
        tenantId,
        amount: refundAmount,
        currency: originalTransaction.currency,
        type: refundAmount === originalTransaction.amount ? 'refund' : 'partial_refund',
        status: 'processing',
        provider: ((originalTransaction.raw as any)?.provider),
        providerTransactionId: providerRefundResult.providerRefundId,
        paymentMethod: (originalTransaction.raw as any)?.payment_method,
        parentTransactionId: originalTransaction.id,
        metadata: {
          reason: validatedRequest.reason,
          originalTransactionId: originalTransaction.id,
          ...validatedRequest.metadata
        }
      });

      // Update reservation status if full refund
      if (refundAmount === originalTransaction.amount) {
        await this.supabase
          .from('reservations')
          .update({
            // reservations has no updated_at column.
            status: 'refunded'
          })
          .eq('id', originalTransaction.subject_id);
      }

      // Publish refund initiated event
      await this.eventBus.publishEvent(
        originalTransaction.subject_id,
        'booking',
        'refund.initiated',
        {
          refundId: refundTransaction.id,
          originalPaymentId: originalTransaction.id,
          amount: refundAmount,
          currency: originalTransaction.currency,
          reason: validatedRequest.reason
        },
        { tenantId }
      );

      return {
        refundId: refundTransaction.id,
        status: refundTransaction.status,
        providerRefundId: providerRefundResult.providerRefundId
      };

    } catch (error) {
      defaultLogger.error('Error processing refund:', error);
      throw error;
    }
  }

  /**
   * Process refund completion from webhook
   */
  async processRefundCompleted(
    providerRefundId: string,
    provider: PaymentProvider,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    try {
      const { data: refundTransaction, error } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('provider_reference', providerRefundId)
        .or('type.eq.refund,type.eq.partial_refund')
        .single();

      if (error || !refundTransaction) {
        throw new Error(`Refund transaction not found: ${providerRefundId}`);
      }

      // Update refund status
      await this.updateTransactionStatus(refundTransaction.id, 'completed', {
        completedAt: new Date().toISOString(),
        providerMetadata: metadata
      });

      // Record in ledger (reverse the original entry)
      await this.recordLedgerEntry({
        transactionId: refundTransaction.id,
        tenantId: refundTransaction.tenant_id,
        debitAccount: 'revenue',
        creditAccount: 'customer_refunds',
        amount: refundTransaction.amount,
        currency: refundTransaction.currency,
        description: `Refund completed for transaction ${refundTransaction.original_transaction_id}`
      });

      // Publish refund completed event
      await this.eventBus.publishEvent(
        refundTransaction.subject_id,
        'booking',
        'refund.completed',
        {
          refundId: refundTransaction.id,
          originalPaymentId: refundTransaction.original_transaction_id,
          amount: refundTransaction.amount,
          currency: refundTransaction.currency
        },
        { tenantId: refundTransaction.tenant_id }
      );

    } catch (error) {
      defaultLogger.error('Error processing refund completion:', error);
      throw error;
    }
  }

  // ===============================
  // LEDGER & RECONCILIATION
  // ===============================

  /**
   * Record ledger entry for double-entry bookkeeping
   */
  async recordLedgerEntry(entry: {
    transactionId: string;
    tenantId: string;
    debitAccount: string;
    creditAccount: string;
    amount: number;
    currency: string;
    description: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('ledger_entries')
        .insert([
          {
            transaction_id: entry.transactionId,
            tenant_id: entry.tenantId,
            account: entry.debitAccount,
            type: 'debit',
            amount: entry.amount,
            currency: entry.currency,
            description: entry.description,
            metadata: entry.metadata,
            created_at: new Date().toISOString()
          },
          {
            transaction_id: entry.transactionId,
            tenant_id: entry.tenantId,
            account: entry.creditAccount,
            type: 'credit',
            amount: entry.amount,
            currency: entry.currency,
            description: entry.description,
            metadata: entry.metadata,
            created_at: new Date().toISOString()
          }
        ]);

      if (error) {
        throw new Error(`Failed to record ledger entry: ${error.message}`);
      }

    } catch (error) {
      defaultLogger.error('Error recording ledger entry:', error);
      throw error;
    }
  }

  /**
   * Reconcile payments with provider
   */
  async reconcilePayments(
    provider: PaymentProvider,
    startDate: string,
    endDate: string,
    tenantId?: string
  ): Promise<{
    matched: number;
    unmatched: Array<{ provider: any; local?: any }>;
    discrepancies: Array<{ transactionId: string; issue: string }>;
  }> {
    try {
      // Get provider transactions for period
      const providerTransactions = await this.getProviderTransactions(
        provider,
        startDate,
        endDate
      );

      // Get local transactions for period
      let query = this.supabase
        .from('transactions')
        .select('*')
        .eq('raw->>provider', provider)
        .gte('created_at', startDate)
        .lte('created_at', endDate);

      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data: localTransactions, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch local transactions: ${error.message}`);
      }

      // Reconcile transactions
      const results = {
        matched: 0,
        unmatched: [] as Array<{ provider: any; local?: any }>,
        discrepancies: [] as Array<{ transactionId: string; issue: string }>
      };

      const localByProviderTxnId = new Map(
        localTransactions?.map(txn => [txn.provider_reference, txn]) || []
      );

      const providerByTxnId = new Map(
        providerTransactions.map(txn => [txn.id, txn])
      );

      // Check provider transactions against local
      for (const providerTxn of providerTransactions) {
        const localTxn = localByProviderTxnId.get(providerTxn.id);
        
        if (!localTxn) {
          results.unmatched.push({ provider: providerTxn });
          continue;
        }

        // Check for discrepancies
        if (localTxn.amount !== providerTxn.amount) {
          results.discrepancies.push({
            transactionId: localTxn.id,
            issue: `Amount mismatch: local ${localTxn.amount}, provider ${providerTxn.amount}`
          });
        }

        if (localTxn.status !== this.mapProviderStatus(providerTxn.status, provider)) {
          results.discrepancies.push({
            transactionId: localTxn.id,
            issue: `Status mismatch: local ${localTxn.status}, provider ${providerTxn.status}`
          });
        }

        results.matched++;
      }

      // Check for local transactions without provider match
      for (const [providerTxnId, localTxn] of localByProviderTxnId) {
        if (!providerByTxnId.has(providerTxnId)) {
          results.unmatched.push({ provider: null, local: localTxn });
        }
      }

      return results;

    } catch (error) {
      defaultLogger.error('Error reconciling payments:', error);
      throw error;
    }
  }

  // ===============================
  // FRAUD DETECTION & PREVENTION
  // ===============================

  /**
   * Analyze transaction for fraud indicators
   */
  async analyzeFraudRisk(transactionData: {
    amount: number;
    currency: string;
    provider: PaymentProvider;
    method: PaymentMethod;
    customerId?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
  }): Promise<{
    riskScore: number; // 0-100, higher is riskier
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    indicators: Array<{ type: string; severity: number; description: string }>;
    recommendation: 'approve' | 'review' | 'decline';
  }> {
    const indicators: Array<{ type: string; severity: number; description: string }> = [];
    let riskScore = 0;

    // Amount-based risk
    if (transactionData.amount > 100000) { // > $1000
      indicators.push({
        type: 'high_amount',
        severity: 30,
        description: 'Transaction amount is unusually high'
      });
      riskScore += 30;
    }

    // Frequency-based risk
    const recentTransactions = await this.getRecentTransactions(
      transactionData.customerId,
      transactionData.ipAddress,
      24 // hours
    );

    if (recentTransactions.length > 5) {
      indicators.push({
        type: 'high_frequency',
        severity: 25,
        description: 'Multiple transactions in short time period'
      });
      riskScore += 25;
    }

    // Geographic risk (if IP geolocation available)
    if (transactionData.ipAddress) {
      const geoRisk = await this.analyzeGeographicRisk(transactionData.ipAddress);
      if (geoRisk.isHighRisk) {
        indicators.push({
          type: 'geographic_risk',
          severity: geoRisk.severity,
          description: geoRisk.description
        });
        riskScore += geoRisk.severity;
      }
    }

    // Device fingerprinting risk
    if (transactionData.deviceFingerprint) {
      const deviceRisk = await this.analyzeDeviceRisk(transactionData.deviceFingerprint);
      if (deviceRisk.isRisky) {
        indicators.push({
          type: 'device_risk',
          severity: deviceRisk.severity,
          description: deviceRisk.description
        });
        riskScore += deviceRisk.severity;
      }
    }

    // Determine risk level and recommendation
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    let recommendation: 'approve' | 'review' | 'decline';

    if (riskScore < 25) {
      riskLevel = 'low';
      recommendation = 'approve';
    } else if (riskScore < 50) {
      riskLevel = 'medium';
      recommendation = 'review';
    } else if (riskScore < 75) {
      riskLevel = 'high';
      recommendation = 'review';
    } else {
      riskLevel = 'critical';
      recommendation = 'decline';
    }

    return {
      riskScore: Math.min(riskScore, 100),
      riskLevel,
      indicators,
      recommendation
    };
  }

  // ===============================
  // HELPER METHODS
  // ===============================

  private async verifyReservation(bookingId: string, tenantId: string) {
    const { data: booking, error } = await this.supabase
      .from('reservations')
      .select('*')
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !booking) {
      throw new Error(`Reservation not found: ${bookingId}`);
    }

    return booking;
  }

  private async checkExistingPayment(bookingId: string) {
    const { data: existing, error } = await this.supabase
      .from('transactions')
      .select('*')
      .eq('subject_id', bookingId)
      .eq('type', 'payment')
      .in('status', ['pending', 'processing', 'completed'])
      .single();

    return error ? null : existing;
  }

  private async createProviderPayment(
    request: CreatePaymentRequest,
    booking: any,
    tenantId: string
  ) {
    const amountMinorUnits = Math.round(request.amount * 100);
    switch (request.provider) {
      case 'stripe':    return this.createStripePayment(request, amountMinorUnits, tenantId);
      case 'paystack':  return this.createPaystackPayment(request, booking, amountMinorUnits, tenantId);
      case 'flutterwave': return this.createFlutterwavePayment(request, booking, amountMinorUnits, tenantId);
      default: throw new Error(`Unsupported payment provider: ${request.provider}`);
    }
  }

  private async createStripePayment(request: CreatePaymentRequest, amountMinorUnits: number, tenantId: string) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error('Stripe credentials not configured');

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const body = new URLSearchParams({
      amount: String(amountMinorUnits),
      currency: request.currency.toLowerCase(),
      'payment_method_types[]': 'card',
      'metadata[booking_id]': request.bookingId,
      'metadata[reservation_id]': request.bookingId,
      'metadata[tenant_id]': tenantId,
    });
    if (request.description) body.append('description', request.description);

    const resp = await fetchWithTimeout('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${stripeKey}`,
        'Idempotency-Key': `payment_${request.bookingId}_${tenantId}`,
      },
      body,
      timeoutMs: 15_000,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Stripe payment creation failed: ${err?.error?.message || resp.status}`);
    }
    const data = await resp.json();
    return {
      providerPaymentId: data.id,
      clientSecret: data.client_secret,
      paymentUrl: null,
      providerData: { created: new Date(data.created * 1000).toISOString(), provider: 'stripe', method: request.method, status: data.status },
    };
  }

  private async createPaystackPayment(request: CreatePaymentRequest, booking: any, amountMinorUnits: number, tenantId: string) {
    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) throw new Error('Paystack credentials not configured');

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const reference = `pay_${request.bookingId}_${Date.now()}`;
    const email = booking.customer_email || booking.metadata?.customer_email || 'noemail@boka.app';

    const resp = await fetchWithTimeout('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paystackKey}` },
      body: JSON.stringify({
        amount: amountMinorUnits,
        email,
        reference,
        currency: request.currency.toUpperCase(),
        metadata: { booking_id: request.bookingId, reservation_id: request.bookingId, tenant_id: tenantId, ...request.metadata },
        ...(request.description ? { label: request.description } : {}),
      }),
      timeoutMs: 15_000,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Paystack payment creation failed: ${err?.message || resp.status}`);
    }
    const data = await resp.json();
    return {
      providerPaymentId: data.data.reference,
      clientSecret: null,
      paymentUrl: data.data.authorization_url,
      providerData: { created: new Date().toISOString(), provider: 'paystack', method: request.method, access_code: data.data.access_code },
    };
  }

  private async createFlutterwavePayment(request: CreatePaymentRequest, booking: any, amountMinorUnits: number, tenantId: string) {
    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) throw new Error('Flutterwave credentials not configured');

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const txRef = `pay_${request.bookingId}_${Date.now()}`;
    const email = booking.customer_email || booking.metadata?.customer_email || 'noemail@boka.app';
    const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/payments/flutterwave/callback`;

    const resp = await fetchWithTimeout('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${flwKey}` },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amountMinorUnits / 100,
        currency: request.currency.toUpperCase(),
        redirect_url: redirectUrl,
        customer: { email },
        meta: { booking_id: request.bookingId, reservation_id: request.bookingId, tenant_id: tenantId, ...request.metadata },
      }),
      timeoutMs: 15_000,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Flutterwave payment creation failed: ${err?.message || resp.status}`);
    }
    const data = await resp.json();
    return {
      providerPaymentId: txRef,
      clientSecret: null,
      paymentUrl: data.data?.link || null,
      providerData: { created: new Date().toISOString(), provider: 'flutterwave', method: request.method },
    };
  }

  private async createTransaction(data: {
    bookingId: string;
    tenantId: string;
    amount: number;
    currency: string;
    type: TransactionType;
    status: PaymentStatus;
    provider: PaymentProvider;
    providerTransactionId: string;
    paymentMethod: PaymentMethod;
    parentTransactionId?: string;
    metadata?: Record<string, any>;
  }) {
    // Map to the real transactions schema: the reservation id is subject_id
    // (+ subject_type), the provider ref is provider_reference, refund parent is
    // original_transaction_id, and provider/method/metadata live in `raw`.
    const { data: transaction, error } = await this.supabase
      .from('transactions')
      .insert({
        subject_type: 'reservation',
        subject_id: data.bookingId,
        tenant_id: data.tenantId,
        amount: data.amount,
        currency: data.currency,
        type: data.type,
        status: data.status,
        provider_reference: data.providerTransactionId,
        original_transaction_id: data.parentTransactionId,
        raw: {
          provider: data.provider,
          payment_method: data.paymentMethod,
          ...(data.metadata ?? {}),
        },
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create transaction: ${error.message}`);
    }

    return transaction;
  }

  private async updateTransactionStatus(
    transactionId: string,
    status: PaymentStatus,
    extra?: Record<string, any>
  ) {
    // Merge status detail into `raw` (there is no `metadata` column) rather
    // than clobbering it.
    const { data: current } = await this.supabase
      .from('transactions')
      .select('raw')
      .eq('id', transactionId)
      .maybeSingle();
    const currentRaw = (current?.raw && typeof current.raw === 'object')
      ? (current.raw as Record<string, any>)
      : {};

    const { error } = await this.supabase
      .from('transactions')
      .update({
        status,
        raw: { ...currentRaw, ...(extra ?? {}) },
        updated_at: new Date().toISOString()
      })
      .eq('id', transactionId);

    if (error) {
      throw new Error(`Failed to update transaction status: ${error.message}`);
    }
  }

  private async getTotalRefunded(originalTransactionId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select('amount')
      .eq('original_transaction_id', originalTransactionId)
      .eq('status', 'completed')
      .in('type', ['refund', 'partial_refund']);

    if (error) {
      defaultLogger.error('Error getting total refunded:', error);
      return 0;
    }

    return data?.reduce((total, txn) => total + txn.amount, 0) || 0;
  }

  private async createProviderRefund(
    originalTransaction: any,
    amount: number,
    reason: string
  ) {
    const amountMinorUnits = Math.round(amount * 100);
    switch (((originalTransaction.raw as any)?.provider)) {
      case 'stripe':    return this.createStripeRefund(originalTransaction, amountMinorUnits, reason);
      case 'paystack':  return this.createPaystackRefund(originalTransaction, amountMinorUnits, reason);
      case 'flutterwave': return this.createFlutterwaveRefund(originalTransaction, amountMinorUnits, reason);
      default: throw new Error(`Unsupported refund provider: ${((originalTransaction.raw as any)?.provider)}`);
    }
  }

  private async createStripeRefund(originalTransaction: any, amountMinorUnits: number, reason: string) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error('Stripe credentials not configured');

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const stripeReason = reason.toLowerCase().includes('fraud')
      ? 'fraudulent'
      : reason.toLowerCase().includes('duplicate') ? 'duplicate' : 'requested_by_customer';

    const resp = await fetchWithTimeout('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${stripeKey}`,
      },
      body: new URLSearchParams({
        payment_intent: originalTransaction.provider_reference,
        amount: String(amountMinorUnits),
        reason: stripeReason,
      }),
      timeoutMs: 15_000,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Stripe refund failed: ${err?.error?.message || resp.status}`);
    }
    const data = await resp.json();
    return {
      providerRefundId: data.id,
      status: data.status === 'succeeded' ? 'completed' : 'processing',
    };
  }

  private async createPaystackRefund(originalTransaction: any, amountMinorUnits: number, reason: string) {
    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) throw new Error('Paystack credentials not configured');

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const resp = await fetchWithTimeout('https://api.paystack.co/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paystackKey}` },
      body: JSON.stringify({
        transaction: originalTransaction.provider_reference,
        amount: amountMinorUnits,
        merchant_note: reason,
      }),
      timeoutMs: 15_000,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Paystack refund failed: ${err?.message || resp.status}`);
    }
    const data = await resp.json();
    return {
      providerRefundId: data.data?.id ? String(data.data.id) : `paystack_refund_${Date.now()}`,
      status: 'processing',
    };
  }

  private async createFlutterwaveRefund(originalTransaction: any, amountMinorUnits: number, reason: string) {
    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) throw new Error('Flutterwave credentials not configured');

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const resp = await fetchWithTimeout(
      `https://api.flutterwave.com/v3/transactions/${originalTransaction.provider_reference}/refund`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${flwKey}` },
        body: JSON.stringify({ amount: amountMinorUnits / 100, comments: reason }),
        timeoutMs: 15_000,
      }
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Flutterwave refund failed: ${err?.message || resp.status}`);
    }
    const data = await resp.json();
    return {
      providerRefundId: data.data?.id ? String(data.data.id) : `flw_refund_${Date.now()}`,
      status: 'processing',
    };
  }

  private async evaluatePaymentRetry(transaction: any): Promise<void> {
    const failureReason: string = ((transaction.raw as any)?.failureReason || '').toLowerCase();

    // Never retry card-holder or fraud-related declines
    const noRetry = ['fraud', 'stolen_card', 'do_not_honor', 'pickup_card', 'card_velocity_exceeded',
                     'insufficient_funds', 'expired_card', 'incorrect_cvc', 'invalid_card'];
    if (noRetry.some(r => failureReason.includes(r))) return;

    const retryCount = Number((transaction.raw as any)?.retry_count || 0);
    if (retryCount >= 3) return;

    // Only retry transient / network errors
    const retriable = ['network', 'timeout', 'processing_error', 'service_unavailable', 'try_again'];
    const shouldRetry = retriable.some(r => failureReason.includes(r)) || failureReason === '';
    if (!shouldRetry) return;

    // Exponential backoff: 1m, 2m, 4m
    const retryAt = new Date(Date.now() + Math.pow(2, retryCount) * 60_000).toISOString();

    await this.supabase
      .from('transactions')
      .update({
        // transactions has real retry columns — no `metadata` column exists.
        retry_count: retryCount + 1,
        next_retry_at: retryAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id);
  }

  private async getProviderTransactions(
    provider: PaymentProvider,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    switch (provider) {
      case 'stripe':    return this.getStripeTransactions(startDate, endDate);
      case 'paystack':  return this.getPaystackTransactions(startDate, endDate);
      case 'flutterwave': return this.getFlutterwaveTransactions(startDate, endDate);
      default: return [];
    }
  }

  private async getStripeTransactions(startDate: string, endDate: string): Promise<any[]> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return [];

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const params = new URLSearchParams({
      'created[gte]': String(Math.floor(new Date(startDate).getTime() / 1000)),
      'created[lte]': String(Math.floor(new Date(endDate).getTime() / 1000)),
      limit: '100',
    });

    const resp = await fetchWithTimeout(`https://api.stripe.com/v1/payment_intents?${params}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
      timeoutMs: 20_000,
    }).catch(() => null);

    if (!resp?.ok) return [];
    const data = await resp.json().catch(() => ({ data: [] }));
    return (data.data || []).map((pi: any) => ({
      id: pi.id,
      amount: pi.amount / 100,
      currency: pi.currency.toUpperCase(),
      status: pi.status,
      created_at: new Date(pi.created * 1000).toISOString(),
    }));
  }

  private async getPaystackTransactions(startDate: string, endDate: string): Promise<any[]> {
    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) return [];

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    const params = new URLSearchParams({ from: startDate, to: endDate, perPage: '100' });

    const resp = await fetchWithTimeout(`https://api.paystack.co/transaction?${params}`, {
      headers: { 'Authorization': `Bearer ${paystackKey}` },
      timeoutMs: 20_000,
    }).catch(() => null);

    if (!resp?.ok) return [];
    const data = await resp.json().catch(() => ({ data: [] }));
    return (data.data || []).map((txn: any) => ({
      id: txn.reference,
      amount: txn.amount / 100,
      currency: txn.currency,
      status: txn.status,
      created_at: txn.created_at,
    }));
  }

  private async getFlutterwaveTransactions(startDate: string, endDate: string): Promise<any[]> {
    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) return [];

    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
    // Flutterwave date params are YYYY-MM-DD only
    const params = new URLSearchParams({
      from: startDate.slice(0, 10),
      to: endDate.slice(0, 10),
      page: '1',
    });

    const resp = await fetchWithTimeout(`https://api.flutterwave.com/v3/transactions?${params}`, {
      headers: { 'Authorization': `Bearer ${flwKey}` },
      timeoutMs: 20_000,
    }).catch(() => null);

    if (!resp?.ok) return [];
    const data = await resp.json().catch(() => ({ data: [] }));
    return (data.data || []).map((txn: any) => ({
      id: txn.tx_ref,
      amount: txn.amount,
      currency: txn.currency,
      status: txn.status === 'successful' ? 'succeeded' : txn.status,
      created_at: txn.created_at,
    }));
  }

  private mapProviderStatus(providerStatus: string, provider: PaymentProvider): PaymentStatus {
    // Map provider-specific statuses to our standard statuses
    const statusMaps = {
      stripe: {
        'requires_payment_method': 'pending',
        'requires_confirmation': 'pending',
        'requires_action': 'pending',
        'processing': 'processing',
        'succeeded': 'completed',
        'canceled': 'cancelled'
      },
      paystack: {
        'pending': 'pending',
        'success': 'completed',
        'failed': 'failed',
        'abandoned': 'cancelled'
      },
      flutterwave: {
        'successful': 'completed',
        'failed': 'failed',
        'cancelled': 'cancelled',
        'pending': 'pending',
        'pending-verification': 'processing',
      }
    };

    return (statusMaps as any)[provider]?.[providerStatus] || 'pending';
  }

  private async getRecentTransactions(
    customerId?: string,
    ipAddress?: string,
    hoursBack: number = 24
  ): Promise<any[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursBack);

    const query = this.supabase
      .from('transactions')
      .select('*')
      .gte('created_at', cutoff.toISOString());

    if (customerId) {
      // This would need a customer_id field in transactions table
      // query = query.eq('customer_id', customerId);
    }

    const { data } = await query;
    return data || [];
  }

  private async analyzeGeographicRisk(ipAddress: string) {
    // Skip private / loopback addresses
    if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|::1)/.test(ipAddress)) {
      return { isHighRisk: false, severity: 0, description: '' };
    }

    try {
      const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout');
      // ip-api.com free tier: 45 req/min, no auth required
      const resp = await fetchWithTimeout(
        `http://ip-api.com/json/${ipAddress}?fields=status,countryCode,proxy,hosting`,
        { timeoutMs: 5_000 }
      );
      if (!resp.ok) return { isHighRisk: false, severity: 0, description: '' };

      const geo = await resp.json().catch(() => ({}));
      if (geo.status !== 'success') return { isHighRisk: false, severity: 0, description: '' };

      if (geo.proxy || geo.hosting) {
        return {
          isHighRisk: true,
          severity: 20,
          description: `Transaction from ${geo.proxy ? 'proxy/VPN' : 'datacenter'} IP (${geo.countryCode})`,
        };
      }

      return { isHighRisk: false, severity: 0, description: '' };
    } catch {
      // Non-fatal: geolocation failure must not block payments
      return { isHighRisk: false, severity: 0, description: '' };
    }
  }

  private async analyzeDeviceRisk(deviceFingerprint: string) {
    try {
      // 1. Check against known flagged device fingerprints
      const { data: flagged } = await this.supabase
        .from('flagged_devices')
        .select('risk_level, reason')
        .eq('fingerprint', deviceFingerprint)
        .maybeSingle();

      if (flagged) {
        const severity = flagged.risk_level === 'high' ? 35 : flagged.risk_level === 'medium' ? 20 : 10;
        return {
          isRisky: true,
          severity,
          description: `Device fingerprint previously flagged: ${flagged.reason || 'suspicious activity'}`,
        };
      }

      // 2. Card-testing signal: same device used in many transactions
      const { count } = await this.supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('metadata->>device_fingerprint', deviceFingerprint)
        .neq('status', 'failed');

      if ((count || 0) > 10) {
        return {
          isRisky: true,
          severity: 25,
          description: `Device fingerprint linked to ${count} transactions — possible card testing`,
        };
      }

      return { isRisky: false, severity: 0, description: '' };
    } catch {
      return { isRisky: false, severity: 0, description: '' };
    }
  }
}

// ===============================
// SINGLETON INSTANCE
// ===============================

let paymentServiceInstance: PaymentLifecycleService | null = null;

export function getPaymentService(): PaymentLifecycleService {
  if (!paymentServiceInstance) {
    paymentServiceInstance = new PaymentLifecycleService();
  }
  return paymentServiceInstance;
}

// ===============================
// UNIFIED POST-PAYMENT HANDLER
// Called by all three webhook handlers after signature verification
// ===============================

export interface PaymentSuccessInput {
  tenantId: string;
  /** Payment reference / transaction ID from the provider */
  reference: string;
  provider: 'paystack' | 'stripe' | 'flutterwave';
  /** Raw amount in minor units (kobo / cents) — optional */
  amountMinor?: number;
  currency?: string;
  /** The reservation/booking ID if available from payment metadata */
  reservationId?: string | null;
}

type PaymentOutcomeInput = PaymentSuccessInput & {
  reason?: string | null;
};

async function getRetailPaymentContext(
  tenantId: string,
  reference: string
): Promise<{
  orderId: string | null;
  externalCustomerRef: string | null;
  channel: 'whatsapp' | 'instagram';
  amountMinor: number | null;
  currency: string | null;
}> {
  const supabase = createServerSupabaseClient();
  const { data: tx } = await supabase
    .from('transactions')
    .select('amount, currency, raw')
    .eq('provider_reference', reference)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const raw = (tx?.raw ?? null) as Record<string, unknown> | null;
  return {
    orderId: typeof raw?.retail_order_id === 'string' ? raw.retail_order_id : null,
    externalCustomerRef: typeof raw?.external_customer_ref === 'string' ? raw.external_customer_ref : null,
    channel: raw?.channel === 'instagram' ? 'instagram' : 'whatsapp',
    amountMinor: typeof tx?.amount === 'number' ? Math.round(Number(tx.amount) * 100) : null,
    currency: typeof tx?.currency === 'string' ? tx.currency : null,
  };
}

async function updateRetailConversationState(input: {
  tenantId: string;
  externalCustomerRef: string;
  channel: 'whatsapp' | 'instagram';
  stage: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  orderId: string;
  reference: string;
  totalCents?: number | null;
}) {
  const { getConversation, updateConversation } = await import('@/lib/whatsapp/v2/conversationState');
  const conv = await getConversation(input.externalCustomerRef, input.tenantId, input.channel);
  if (!conv) return;

  await updateConversation(input.externalCustomerRef, input.tenantId, {
    current_flow: conv.current_flow === 'booking' ? 'booking' : 'managing',
    flow_data: {
      ...conv.flow_data,
      sales_journey: {
        ...(conv.flow_data?.sales_journey ?? {}),
        stage: input.stage,
        last_payment_reference: input.reference,
      },
      retail_order: {
        ...(conv.flow_data?.retail_order ?? {}),
        order_id: input.orderId,
        payment_reference: input.reference,
        payment_status: input.paymentStatus,
        total_cents: input.totalCents ?? conv.flow_data?.retail_order?.total_cents ?? null,
      },
    },
  }, input.channel);
}

async function sendRetailPaymentMessage(input: {
  tenantId: string;
  externalCustomerRef: string;
  channel: 'whatsapp' | 'instagram';
  text: string;
  messageType?: 'payment_receipt';
}) {
  try {
    if (input.channel === 'whatsapp' && input.messageType) {
      await sendGovernedWhatsAppPaymentMessage({
        tenantId: input.tenantId,
        recipient: input.externalCustomerRef,
        messageType: input.messageType,
        text: input.text,
      });
      return;
    }

    const { getTenantChannelProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
    const provider = await getTenantChannelProviderClient(input.tenantId, input.channel);
    if (!provider) return;
    await provider.sendTextMessage(input.externalCustomerRef, input.text);
  } catch (error) {
    defaultLogger.warn('[lifecycle] retail payment message send failed', error);
  }
}

function toTemplateParameters(paramMapping: unknown[]): Array<{ default: string }> {
  return paramMapping.map((entry) => {
    if (entry && typeof entry === 'object' && 'default' in entry) {
      return { default: String((entry as { default?: unknown }).default ?? '') };
    }
    return { default: String(entry ?? '') };
  });
}

/**
 * Paid confirmations are business-initiated WhatsApp sends. They must pass the
 * shared-number governor and the 24-hour/template gate. A missing conversation
 * or approved payment_receipt template therefore safely results in no send.
 */
async function sendGovernedWhatsAppPaymentMessage(input: {
  tenantId: string;
  recipient: string;
  messageType: 'payment_receipt';
  text: string;
}): Promise<boolean> {
  const { getConversation } = await import('@/lib/whatsapp/v2/conversationState');
  const { brandCustomerText } = await import('@/lib/whatsapp/v2/outboundBranding');
  const { sendGovernedInitiated } = await import('@/lib/whatsapp/v2/deliverability/governedSend');
  const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');

  const [conversation, client] = await Promise.all([
    getConversation(input.recipient, input.tenantId, 'whatsapp'),
    getTenantWhatsAppProviderClient(input.tenantId),
  ]);
  if (!client) return false;

  const result = await sendGovernedInitiated(createServerSupabaseClient() as never, {
    tenantId: input.tenantId,
    recipient: input.recipient,
    messageType: input.messageType,
    lastInboundAt: conversation?.last_inbound_at ?? null,
    optedOutAt: conversation?.opted_out_at ?? null,
    buildFreeform: () => input.text,
    sendFreeform: async (text) => {
      const branded = await brandCustomerText(input.tenantId, input.recipient, text, {
        initiated: true,
        conv: conversation
          ? {
              last_inbound_at: conversation.last_inbound_at,
              opted_out_at: conversation.opted_out_at,
            }
          : undefined,
      });
      if (!branded) return false;
      return (await client.sendTextMessage(input.recipient, branded)).success;
    },
    sendTemplate: async (name, language, paramMapping) => {
      if (!client.sendTemplateMessage) return false;
      return (
        await client.sendTemplateMessage(
          input.recipient,
          name,
          toTemplateParameters(paramMapping),
          language,
        )
      ).success;
    },
  });

  return result.sent;
}

async function handleRetailPaymentSuccess(input: PaymentSuccessInput & {
  orderId: string;
  externalCustomerRef: string | null;
  channel: 'whatsapp' | 'instagram';
}) {
  const { transitionRetailOrder, getRetailOrderById } = await import('@/lib/commerce/retail-orders');
  const order = await transitionRetailOrder({
    tenantId: input.tenantId,
    orderId: input.orderId,
    actorUserId: 'payment_webhook',
    action: 'mark_paid',
  });

  const totalCents = Number((order as Record<string, unknown>)?.total_cents ?? input.amountMinor ?? 0);
  await recordFrontDeskEvent({
    tenantId: input.tenantId,
    eventType: 'payment_completed',
    eventCategory: 'payment',
    channel: 'whatsapp',
    correlationId: input.reference,
    amount: typeof input.amountMinor === 'number' ? input.amountMinor / 100 : totalCents / 100,
    currency: input.currency ?? 'NGN',
    statusTo: 'success',
    metadata: {
      provider: input.provider,
      retail_order_id: input.orderId,
      source: 'handlePaymentSuccess',
    },
  });

  if (input.externalCustomerRef) {
    await updateRetailConversationState({
      tenantId: input.tenantId,
      externalCustomerRef: input.externalCustomerRef,
      channel: input.channel,
      stage: 'paid',
      paymentStatus: 'paid',
      orderId: input.orderId,
      reference: input.reference,
      totalCents,
    }).catch(() => undefined);
    await sendRetailPaymentMessage({
      tenantId: input.tenantId,
      externalCustomerRef: input.externalCustomerRef,
      channel: input.channel,
      text: `Payment received ✅ Your order is now confirmed. Total paid: ₦${Math.round(totalCents / 100).toLocaleString()}. We’ll keep you posted on fulfillment here.`,
      messageType: 'payment_receipt',
    });
  }

  defaultLogger.info(`[lifecycle] Retail payment confirmed: order=${input.orderId} provider=${input.provider} ref=${input.reference}`);
  return getRetailOrderById(input.tenantId, input.orderId);
}

async function handleRetailPaymentFailure(input: PaymentOutcomeInput & {
  orderId: string;
  externalCustomerRef: string | null;
  channel: 'whatsapp' | 'instagram';
}) {
  const { transitionRetailOrder } = await import('@/lib/commerce/retail-orders');
  const order = await transitionRetailOrder({
    tenantId: input.tenantId,
    orderId: input.orderId,
    actorUserId: 'payment_webhook',
    action: 'mark_payment_failed',
    notes: input.reason ?? null,
  });

  const totalCents = Number((order as Record<string, unknown>)?.total_cents ?? input.amountMinor ?? 0);
  await recordFrontDeskEvent({
    tenantId: input.tenantId,
    eventType: 'payment_failed',
    eventCategory: 'payment',
    channel: 'whatsapp',
    correlationId: input.reference,
    amount: typeof input.amountMinor === 'number' ? input.amountMinor / 100 : totalCents / 100,
    currency: input.currency ?? 'NGN',
    statusTo: 'failed',
    metadata: {
      provider: input.provider,
      retail_order_id: input.orderId,
      reason: input.reason ?? null,
      source: 'handlePaymentFailure',
    },
  });

  if (input.externalCustomerRef) {
    await updateRetailConversationState({
      tenantId: input.tenantId,
      externalCustomerRef: input.externalCustomerRef,
      channel: input.channel,
      stage: 'payment_failed',
      paymentStatus: 'failed',
      orderId: input.orderId,
      reference: input.reference,
      totalCents,
    }).catch(() => undefined);
    await sendRetailPaymentMessage({
      tenantId: input.tenantId,
      externalCustomerRef: input.externalCustomerRef,
      channel: input.channel,
      text: `Your payment didn’t go through, so your order is still saved as a draft. ${input.reason ? `Reason: ${input.reason}. ` : ''}Reply anytime and I can send a fresh payment link.`,
    });
  }
}

export async function handlePaymentFailure(input: PaymentOutcomeInput): Promise<void> {
  try {
    if (!input.reservationId) {
      const retail = await getRetailPaymentContext(input.tenantId, input.reference);
      if (retail.orderId) {
        await handleRetailPaymentFailure({
          ...input,
          orderId: retail.orderId,
          externalCustomerRef: retail.externalCustomerRef,
          channel: retail.channel,
          amountMinor: input.amountMinor ?? retail.amountMinor ?? undefined,
          currency: input.currency ?? retail.currency ?? undefined,
        });
        return;
      }
    }

    if (input.reservationId) {
      const supabase = createServerSupabaseClient();
      await supabase
        .from('transactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('provider_reference', input.reference)
        .eq('tenant_id', input.tenantId);

      await supabase
        .from('reservations')
        .update({ status: 'payment_failed' })
        .eq('id', input.reservationId)
        .eq('tenant_id', input.tenantId);

      await recordFrontDeskEvent({
        tenantId: input.tenantId,
        eventType: 'payment_failed',
        eventCategory: 'payment',
        channel: input.provider,
        reservationId: input.reservationId,
        correlationId: input.reference,
        amount: typeof input.amountMinor === 'number' ? input.amountMinor / 100 : null,
        currency: input.currency ?? null,
        statusTo: 'failed',
        metadata: {
          provider: input.provider,
          reason: input.reason ?? null,
          source: 'handlePaymentFailure',
        },
      });
    }
  } catch (err) {
    defaultLogger.error('[lifecycle] handlePaymentFailure error', err);
  }
}

async function handleRetailPaymentRefund(input: PaymentOutcomeInput & {
  orderId: string;
  externalCustomerRef: string | null;
  channel: 'whatsapp' | 'instagram';
}) {
  const { transitionRetailOrder } = await import('@/lib/commerce/retail-orders');
  const order = await transitionRetailOrder({
    tenantId: input.tenantId,
    orderId: input.orderId,
    actorUserId: 'payment_webhook',
    action: 'mark_refunded',
    notes: input.reason ?? null,
  });

  const totalCents = Number((order as Record<string, unknown>)?.total_cents ?? input.amountMinor ?? 0);
  await recordFrontDeskEvent({
    tenantId: input.tenantId,
    eventType: 'payment_refunded',
    eventCategory: 'payment',
    channel: 'whatsapp',
    correlationId: input.reference,
    amount: typeof input.amountMinor === 'number' ? input.amountMinor / 100 : totalCents / 100,
    currency: input.currency ?? 'NGN',
    statusTo: 'refunded',
    metadata: {
      provider: input.provider,
      retail_order_id: input.orderId,
      source: 'handlePaymentRefund',
    },
  });

  if (input.externalCustomerRef) {
    await updateRetailConversationState({
      tenantId: input.tenantId,
      externalCustomerRef: input.externalCustomerRef,
      channel: input.channel,
      stage: 'refunded',
      paymentStatus: 'refunded',
      orderId: input.orderId,
      reference: input.reference,
      totalCents,
    }).catch(() => undefined);
    await sendRetailPaymentMessage({
      tenantId: input.tenantId,
      externalCustomerRef: input.externalCustomerRef,
      channel: input.channel,
      text: 'Your order payment has been refunded. If you still want the items, reply here and I’ll help you start a new order.',
    });
  }
}

export async function handlePaymentRefund(input: PaymentOutcomeInput): Promise<void> {
  try {
    if (!input.reservationId) {
      const retail = await getRetailPaymentContext(input.tenantId, input.reference);
      if (retail.orderId) {
        await handleRetailPaymentRefund({
          ...input,
          orderId: retail.orderId,
          externalCustomerRef: retail.externalCustomerRef,
          channel: retail.channel,
          amountMinor: input.amountMinor ?? retail.amountMinor ?? undefined,
          currency: input.currency ?? retail.currency ?? undefined,
        });
        return;
      }
    }

    if (input.reservationId) {
      const supabase = createServerSupabaseClient();
      await supabase
        .from('transactions')
        .update({ status: 'refunded', updated_at: new Date().toISOString() })
        .eq('provider_reference', input.reference)
        .eq('tenant_id', input.tenantId);

      await supabase
        .from('reservations')
        .update({ status: 'refunded' })
        .eq('id', input.reservationId)
        .eq('tenant_id', input.tenantId);

      await recordFrontDeskEvent({
        tenantId: input.tenantId,
        eventType: 'payment_refunded',
        eventCategory: 'payment',
        channel: input.provider,
        reservationId: input.reservationId,
        correlationId: input.reference,
        amount: typeof input.amountMinor === 'number' ? input.amountMinor / 100 : null,
        currency: input.currency ?? null,
        statusTo: 'refunded',
        metadata: {
          provider: input.provider,
          source: 'handlePaymentRefund',
        },
      });
    }
  } catch (err) {
    defaultLogger.error('[lifecycle] handlePaymentRefund error', err);
  }
}

/**
 * handlePaymentSuccess — shared post-payment confirmation path
 *
 * 1. Resolve reservation from reference or metadata
 * 2. Mark reservation confirmed
 * 3. Mark transaction successful
 * 4. Send WhatsApp confirmation with calendar link
 * 5. Send email confirmation with calendar link
 */
export async function handlePaymentSuccess(input: PaymentSuccessInput): Promise<void> {
  const supabase = createServerSupabaseClient();
  const { tenantId, reference, provider, reservationId, amountMinor, currency } = input;

  try {
    if (!reservationId) {
      const retail = await getRetailPaymentContext(tenantId, reference);
      if (retail.orderId) {
        await handleRetailPaymentSuccess({
          ...input,
          orderId: retail.orderId,
          externalCustomerRef: retail.externalCustomerRef,
          channel: retail.channel,
          amountMinor: amountMinor ?? retail.amountMinor ?? undefined,
          currency: currency ?? retail.currency ?? undefined,
        });
        return;
      }
    }

    // 1. Resolve reservation
    let bookingId: string | null = reservationId || null;

    if (!bookingId) {
      const { data: tx } = await supabase
        .from('transactions')
        .select('raw')
        .eq('provider_reference', reference)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      bookingId = (tx?.raw as any)?.reservation_id ?? null;
    }

    if (!bookingId) {
      defaultLogger.warn(`[lifecycle] handlePaymentSuccess: no reservation for ref=${reference} tenant=${tenantId}`);
      return;
    }

    // 2. Confirm reservation — only update if not already in a terminal state
    // (prevents reactivating cancelled reservations when a late payment arrives)
    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      // reservations has no updated_at column — writing it errors the whole
      // update, so a paid booking would never flip to confirmed.
      .update({ status: 'confirmed' })
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .not('status', 'in', '("cancelled","completed","refunded")')
      // Authoritative columns only: number is customer_number; name/email live in metadata.
      .select('id, start_at, end_at, customer_number, notes, service_id, metadata')
      .maybeSingle();

    if (resError) {
      defaultLogger.error('[lifecycle] handlePaymentSuccess: reservation update failed', resError);
    }

    // 3. Mark transaction success
    await supabase
      .from('transactions')
      .update({ status: 'success', updated_at: new Date().toISOString() })
      .eq('provider_reference', reference)
      .eq('tenant_id', tenantId);

    await recordFrontDeskEvent({
      tenantId,
      eventType: 'payment_completed',
      eventCategory: 'payment',
      channel: provider,
      reservationId: bookingId,
      correlationId: reference,
      amount: typeof amountMinor === 'number' ? amountMinor / 100 : null,
      currency: currency ?? null,
      statusTo: 'success',
      metadata: {
        provider,
        source: 'handlePaymentSuccess',
      },
    });

    if (!reservation) return;

    // Contact details: number is customer_number; name/email live in metadata.
    const reservationRow = reservation as typeof reservation & {
      customer_number?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const meta = reservationRow.metadata || {};
    const customerPhone = reservationRow.customer_number || null;
    const customerEmail = (meta.customer_email as string | undefined) || null;
    const customerName = (meta.customer_name as string | undefined) || null;

    // Fetch service details
    const { data: service } = await supabase
      .from('services')
      .select('name, duration')
      .eq('id', reservation.service_id)
      .maybeSingle();

    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('name, metadata')
      .eq('id', tenantId)
      .maybeSingle();

    const serviceName: string = service?.name || 'Appointment';
    const durationMinutes: number = service?.duration || 60;
    const tenantName: string = tenantRow?.name || 'Boka';
    const startAt = new Date(reservation.start_at);
    const endAt = reservation.end_at
      ? new Date(reservation.end_at)
      : new Date(startAt.getTime() + durationMinutes * 60000);

    const dateStr = startAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const calendarEvent = {
      title: `${serviceName} - ${tenantName}`,
      description: `Service: ${serviceName}\nBooking ref: #${bookingId.slice(-6).toUpperCase()}${reservation.notes ? `\nNotes: ${reservation.notes}` : ''}`,
      startTime: startAt,
      endTime: endAt,
    };

    // 4. WhatsApp confirmation. Successful-payment confirmations are governed
    // business-initiated sends; outside the service window an approved template
    // is required or this intentionally holds.
    if (customerPhone) {
      try {
        const { buildBookingConfirmationWhatsAppText } = await import('@/lib/integrations/whatsapp-service');
        await sendGovernedWhatsAppPaymentMessage({
          tenantId,
          recipient: customerPhone,
          messageType: 'payment_receipt',
          text: buildBookingConfirmationWhatsAppText(customerName || 'there', {
            serviceName,
            date: dateStr,
            time: timeStr,
            calendarEvent,
          }),
        });
      } catch (waErr) {
        defaultLogger.warn('[lifecycle] WhatsApp confirmation failed', waErr);
      }
    }

    // 5. Email confirmation
    if (customerEmail) {
      try {
        const { sendBookingConfirmation } = await import('@/lib/integrations/email-service');
        await sendBookingConfirmation(
          customerEmail,
          customerName || 'there',
          { serviceName, date: dateStr, time: timeStr, calendarEvent }
        );
      } catch (emailErr) {
        defaultLogger.warn('[lifecycle] Email confirmation failed', emailErr);
      }
    }

    defaultLogger.info(`[lifecycle] Payment confirmed: booking=${bookingId} provider=${provider} ref=${reference}`);
  } catch (err) {
    defaultLogger.error('[lifecycle] handlePaymentSuccess error', err);
  }
}
