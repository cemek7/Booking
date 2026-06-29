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
  metadata: z.record(z.string(), z.any()).optional(),
  description: z.string().optional()
});

const RefundRequestSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(), // If not provided, full refund
  reason: z.string().min(5),
  metadata: z.record(z.string(), z.any()).optional()
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
        .eq('provider_transaction_id', providerPaymentId)
        .eq('provider', provider)
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

      // Confirm reservation after successful payment
      await this.supabase
        .from('reservations')
        .update({
          status: 'confirmed',
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.booking_id);

      // Record in ledger
      await this.recordLedgerEntry({
        transactionId: transaction.id,
        tenantId: transaction.tenant_id,
        debitAccount: 'customer_payments',
        creditAccount: 'revenue',
        amount: transaction.amount,
        currency: transaction.currency,
        description: `Payment completed for reservation ${transaction.booking_id}`
      });

      // Publish payment completed event
      await this.eventBus.publishEvent(
        transaction.booking_id,
        'booking',
        'payment.completed',
        {
          paymentId: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          provider: transaction.provider,
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
        .eq('provider_transaction_id', providerPaymentId)
        .eq('provider', provider)
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
          notes: (transaction.reservation?.notes || '') + `\nPayment failed: ${failureReason}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.booking_id);

      // Publish payment failed event
      await this.eventBus.publishEvent(
        transaction.booking_id,
        'booking',
        'payment.failed',
        {
          paymentId: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          provider: transaction.provider,
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
        bookingId: originalTransaction.booking_id,
        tenantId,
        amount: refundAmount,
        currency: originalTransaction.currency,
        type: refundAmount === originalTransaction.amount ? 'refund' : 'partial_refund',
        status: 'processing',
        provider: originalTransaction.provider,
        providerTransactionId: providerRefundResult.providerRefundId,
        paymentMethod: originalTransaction.payment_method,
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
            status: 'refunded',
            updated_at: new Date().toISOString()
          })
          .eq('id', originalTransaction.booking_id);
      }

      // Publish refund initiated event
      await this.eventBus.publishEvent(
        originalTransaction.booking_id,
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
        .eq('provider_transaction_id', providerRefundId)
        .eq('provider', provider)
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
        description: `Refund completed for transaction ${refundTransaction.parent_transaction_id}`
      });

      // Publish refund completed event
      await this.eventBus.publishEvent(
        refundTransaction.booking_id,
        'booking',
        'refund.completed',
        {
          refundId: refundTransaction.id,
          originalPaymentId: refundTransaction.parent_transaction_id,
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
        .eq('provider', provider)
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
        localTransactions?.map(txn => [txn.provider_transaction_id, txn]) || []
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
      .eq('booking_id', bookingId)
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
    const { data: transaction, error } = await this.supabase
      .from('transactions')
      .insert({
        booking_id: data.bookingId,
        tenant_id: data.tenantId,
        amount: data.amount,
        currency: data.currency,
        type: data.type,
        status: data.status,
        provider: data.provider,
        provider_transaction_id: data.providerTransactionId,
        payment_method: data.paymentMethod,
        parent_transaction_id: data.parentTransactionId,
        metadata: data.metadata,
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
    metadata?: Record<string, any>
  ) {
    const { error } = await this.supabase
      .from('transactions')
      .update({
        status,
        metadata: metadata,
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
      .eq('parent_transaction_id', originalTransactionId)
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
    switch (originalTransaction.provider) {
      case 'stripe':    return this.createStripeRefund(originalTransaction, amountMinorUnits, reason);
      case 'paystack':  return this.createPaystackRefund(originalTransaction, amountMinorUnits, reason);
      case 'flutterwave': return this.createFlutterwaveRefund(originalTransaction, amountMinorUnits, reason);
      default: throw new Error(`Unsupported refund provider: ${originalTransaction.provider}`);
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
        payment_intent: originalTransaction.provider_transaction_id,
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
        transaction: originalTransaction.provider_transaction_id,
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
      `https://api.flutterwave.com/v3/transactions/${originalTransaction.provider_transaction_id}/refund`,
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
    const failureReason: string = (transaction.metadata?.failureReason || '').toLowerCase();

    // Never retry card-holder or fraud-related declines
    const noRetry = ['fraud', 'stolen_card', 'do_not_honor', 'pickup_card', 'card_velocity_exceeded',
                     'insufficient_funds', 'expired_card', 'incorrect_cvc', 'invalid_card'];
    if (noRetry.some(r => failureReason.includes(r))) return;

    const retryCount = Number(transaction.metadata?.retry_count || 0);
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
        metadata: {
          ...transaction.metadata,
          retry_count: retryCount + 1,
          retry_at: retryAt,
          retry_scheduled: true,
        },
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
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .not('status', 'in', '("cancelled","completed","refunded")')
      .select('id, start_at, end_at, customer_name, customer_phone, customer_email, notes, service_id')
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

      // 4. WhatsApp confirmation
    if (reservation.customer_phone) {
      try {
        const { getTenantWhatsAppConfig } = await import('@/lib/whatsapp/evolutionClient');
        const waConfig = await getTenantWhatsAppConfig(tenantId);
        if (waConfig) {
          const { sendBookingConfirmationWhatsApp } = await import('@/lib/integrations/whatsapp-service');
          await sendBookingConfirmationWhatsApp(
            reservation.customer_phone,
            reservation.customer_name || 'there',
            { serviceName, date: dateStr, time: timeStr, calendarEvent }
          );
        }
      } catch (waErr) {
        defaultLogger.warn('[lifecycle] WhatsApp confirmation failed', waErr);
      }
    }

    // 5. Email confirmation
    if (reservation.customer_email) {
      try {
        const { sendBookingConfirmation } = await import('@/lib/integrations/email-service');
        await sendBookingConfirmation(
          reservation.customer_email,
          reservation.customer_name || 'there',
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
