import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace } from '@opentelemetry/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishEvent } from './eventBus';
import { reconciliationDiscrepancy, depositIdempotencyHit } from './metrics';
import crypto from 'crypto';

export interface SecurityMetrics {
  chargeback_rate: number;
  failed_payment_rate: number;
  reconciliation_drift: number;
  suspicious_activity_count: number;
  fraud_score: number;
}

export interface PaymentSecurityConfig {
  max_chargeback_rate: number; // 0.5%
  max_reconciliation_drift: number; // 0.1%
  fraud_detection_enabled: boolean;
  auto_refund_threshold: number; // Amount below which refunds are auto-approved
  webhook_signature_validation: boolean;
  idempotency_window_hours: number; // 24 hours
}

export interface FraudDetectionParams {
  amount: number;
  currency: string;
  email: string;
  ip_address?: string;
  user_agent?: string;
  country_code?: string;
  payment_method?: string;
  tenant_id: string;
}

export interface FraudAssessment {
  risk_score: number; // 0-100
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  recommendation: 'approve' | 'review' | 'decline';
  details: Record<string, unknown>;
}

/**
 * Payment security service implementing fraud detection,
 * chargeback monitoring, and reconciliation safeguards
 */
export class PaymentSecurityService {
  private supabase: SupabaseClient;
  private tracer = trace.getTracer('boka-payment-security');
  private config: PaymentSecurityConfig;

  constructor(supabase: SupabaseClient, config?: Partial<PaymentSecurityConfig>) {
    this.supabase = supabase;
    this.config = {
      max_chargeback_rate: 0.005, // 0.5%
      max_reconciliation_drift: 0.001, // 0.1%
      fraud_detection_enabled: true,
      auto_refund_threshold: 5000, // $50 in cents
      webhook_signature_validation: true,
      idempotency_window_hours: 24,
      ...config
    };
  }

  /**
   * Enhanced idempotency checking with fraud detection
   */
  async checkIdempotency(
    operation: 'payment' | 'refund' | 'webhook',
    key: string,
    tenantId: string,
    amount?: number,
    metadata?: Record<string, unknown>
  ): Promise<{
    isIdempotent: boolean;
    existingTransaction?: any;
    fraud_assessment?: FraudAssessment;
    error?: string;
  }> {
    const span = this.tracer.startSpan('payment_security.check_idempotency');

    try {
      // Generate idempotency hash
      const idempotencyHash = crypto
        .createHash('sha256')
        .update(`${operation}:${tenantId}:${key}`)
        .digest('hex');

      // Check for existing operation within window
      const windowStart = new Date(
        Date.now() - this.config.idempotency_window_hours * 60 * 60 * 1000
      ).toISOString();

      const { data: existing, error } = await this.supabase
        .from('idempotency_keys')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('idempotency_hash', idempotencyHash)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        throw new Error(`Idempotency check failed: ${error.message}`);
      }

      if (existing && existing.length > 0) {
        depositIdempotencyHit(tenantId);
        span.setAttribute('idempotency.hit', true);

        // Return existing transaction
        const existingTransaction = existing[0];
        return {
          isIdempotent: true,
          existingTransaction,
        };
      }

      // Create new idempotency record
      const { error: insertError } = await this.supabase
        .from('idempotency_keys')
        .insert([{
          tenant_id: tenantId,
          operation,
          idempotency_key: key,
          idempotency_hash: idempotencyHash,
          amount,
          metadata,
          status: 'processing'
        }]);

      if (insertError) {
        // Handle race condition
        if (insertError.code === '23505') { // Unique constraint violation
          depositIdempotencyHit(tenantId);
          return { isIdempotent: true };
        }
        throw new Error(`Failed to create idempotency record: ${insertError.message}`);
      }

      // Run fraud detection if enabled and it's a payment
      let fraudAssessment: FraudAssessment | undefined;
      if (this.config.fraud_detection_enabled && operation === 'payment' && amount) {
        fraudAssessment = await this.assessFraud({
          amount,
          currency: 'NGN', // Default, should be passed
          email: metadata?.email as string || '',
          tenant_id: tenantId,
          ip_address: metadata?.ip_address as string,
          user_agent: metadata?.user_agent as string,
          country_code: metadata?.country_code as string,
          payment_method: metadata?.payment_method as string,
        });
      }

      span.setAttribute('idempotency.new', true);
      return {
        isIdempotent: false,
        fraud_assessment: fraudAssessment,
      };

    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Comprehensive fraud detection assessment
   */
  async assessFraud(params: FraudDetectionParams): Promise<FraudAssessment> {
    const span = this.tracer.startSpan('payment_security.assess_fraud');
    
    try {
      let riskScore = 0;
      const flags: string[] = [];
      const details: Record<string, unknown> = {};

      // 1. Amount-based risk assessment
      const amountRisk = this.assessAmountRisk(params.amount, params.currency);
      riskScore += amountRisk.score;
      if (amountRisk.flag) flags.push(amountRisk.flag);
      details.amount_risk = amountRisk;

      // 2. Velocity checks (payment frequency)
      const velocityRisk = await this.assessVelocityRisk(params);
      riskScore += velocityRisk.score;
      if (velocityRisk.flags.length > 0) flags.push(...velocityRisk.flags);
      details.velocity_risk = velocityRisk;

      // 3. Email reputation check
      const emailRisk = await this.assessEmailRisk(params.email, params.tenant_id);
      riskScore += emailRisk.score;
      if (emailRisk.flag) flags.push(emailRisk.flag);
      details.email_risk = emailRisk;

      // 4. Geographic risk assessment
      if (params.country_code) {
        const geoRisk = this.assessGeographicRisk(params.country_code, params.tenant_id);
        riskScore += geoRisk.score;
        if (geoRisk.flag) flags.push(geoRisk.flag);
        details.geographic_risk = geoRisk;
      }

      // 5. Device/IP reputation
      if (params.ip_address) {
        const deviceRisk = await this.assessDeviceRisk(params.ip_address, params.user_agent);
        riskScore += deviceRisk.score;
        if (deviceRisk.flag) flags.push(deviceRisk.flag);
        details.device_risk = deviceRisk;
      }

      // Determine risk level and recommendation
      let riskLevel: FraudAssessment['risk_level'];
      let recommendation: FraudAssessment['recommendation'];

      if (riskScore <= 20) {
        riskLevel = 'low';
        recommendation = 'approve';
      } else if (riskScore <= 50) {
        riskLevel = 'medium';
        recommendation = 'review';
      } else if (riskScore <= 80) {
        riskLevel = 'high';
        recommendation = 'review';
      } else {
        riskLevel = 'critical';
        recommendation = 'decline';
      }

      const assessment: FraudAssessment = {
        risk_score: Math.min(riskScore, 100),
        risk_level: riskLevel,
        flags,
        recommendation,
        details,
      };

      // Log fraud assessment
      await this.logFraudAssessment(params.tenant_id, assessment, params);

      span.setAttribute('fraud.risk_score', assessment.risk_score);
      span.setAttribute('fraud.risk_level', assessment.risk_level);
      span.setAttribute('fraud.recommendation', assessment.recommendation);

      return assessment;

    } catch (error) {
      span.recordException(error as Error);
      // Return low-risk assessment on error to avoid blocking legitimate transactions
      return {
        risk_score: 10,
        risk_level: 'low',
        flags: ['assessment_error'],
        recommendation: 'approve',
        details: { error: (error as Error).message },
      };
    } finally {
      span.end();
    }
  }

  /**
   * Monitor security metrics and trigger alerts
   */
  async monitorSecurityMetrics(tenantId: string): Promise<SecurityMetrics> {
    const span = this.tracer.startSpan('payment_security.monitor_metrics');

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Calculate chargeback rate
      const chargebackRate = await this.calculateChargebackRate(tenantId, thirtyDaysAgo);
      
      // Calculate failed payment rate
      const failedPaymentRate = await this.calculateFailedPaymentRate(tenantId, thirtyDaysAgo);
      
      // Calculate reconciliation drift
      const reconciliationDrift = await this.calculateReconciliationDrift(tenantId);
      
      // Count suspicious activity
      const suspiciousActivityCount = await this.countSuspiciousActivity(tenantId, thirtyDaysAgo);
      
      // Calculate overall fraud score
      const fraudScore = this.calculateOverallFraudScore({
        chargebackRate,
        failedPaymentRate,
        reconciliationDrift,
        suspiciousActivityCount,
      });

      const metrics: SecurityMetrics = {
        chargeback_rate: chargebackRate,
        failed_payment_rate: failedPaymentRate,
        reconciliation_drift: reconciliationDrift,
        suspicious_activity_count: suspiciousActivityCount,
        fraud_score: fraudScore,
      };

      // Check thresholds and trigger alerts
      await this.checkThresholds(tenantId, metrics);

      span.setAttribute('metrics.chargeback_rate', chargebackRate);
      span.setAttribute('metrics.fraud_score', fraudScore);

      return metrics;

    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Enhanced webhook signature validation
   */
  async validateWebhookSignature(
    provider: 'paystack' | 'stripe',
    payload: string,
    signature: string,
    secret: string
  ): Promise<{ valid: boolean; error?: string }> {
    const span = this.tracer.startSpan('payment_security.validate_webhook');

    try {
      if (!this.config.webhook_signature_validation) {
        return { valid: true };
      }

      let isValid = false;

      switch (provider) {
        case 'paystack':
          const paystackHash = crypto
            .createHmac('sha512', secret)
            .update(payload)
            .digest('hex');
          isValid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(paystackHash)
          );
          break;

        case 'stripe':
          // Stripe uses a different signature format: t=timestamp,v1=signature
          const elements = signature.split(',');
          const signatureHash = elements.find(element => element.startsWith('v1='))?.split('=')[1];
          
          if (!signatureHash) {
            return { valid: false, error: 'Invalid Stripe signature format' };
          }

          const stripeHash = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
          
          isValid = crypto.timingSafeEqual(
            Buffer.from(signatureHash),
            Buffer.from(stripeHash)
          );
          break;

        default:
          return { valid: false, error: 'Unsupported payment provider' };
      }

      span.setAttribute('webhook.provider', provider);
      span.setAttribute('webhook.valid', isValid);

      if (!isValid) {
        // Log suspicious webhook attempt
        await this.logSuspiciousActivity(
          'invalid_webhook_signature',
          { provider, signature_provided: !!signature },
          ''
        );
      }

      return { valid: isValid };

    } catch (error) {
      span.recordException(error as Error);
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      span.end();
    }
  }

  // Private helper methods

  private assessAmountRisk(amount: number, currency: string): { score: number; flag?: string } {
    // Convert to USD equivalent for comparison (simplified)
    const usdAmount = currency === 'NGN' ? amount / 1650 : amount / 100;

    if (usdAmount > 1000) {
      return { score: 30, flag: 'high_amount' };
    } else if (usdAmount > 500) {
      return { score: 15, flag: 'medium_amount' };
    } else if (usdAmount < 1) {
      return { score: 20, flag: 'micro_amount' };
    }

    return { score: 0 };
  }

  private async assessVelocityRisk(params: FraudDetectionParams): Promise<{ score: number; flags: string[] }> {
    const flags: string[] = [];
    let score = 0;

    // Check payment frequency in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: recentPayments } = await this.supabase
      .from('transactions')
      .select('id, amount')
      .eq('tenant_id', params.tenant_id)
      .gte('created_at', oneHourAgo);

    if (recentPayments && recentPayments.length > 5) {
      score += 25;
      flags.push('high_frequency');
    }

    // Check for duplicate amounts
    const duplicateAmounts = recentPayments?.filter((p: any) => p.amount === params.amount).length || 0;
    if (duplicateAmounts > 2) {
      score += 15;
      flags.push('duplicate_amounts');
    }

    return { score, flags };
  }

  private async assessEmailRisk(email: string, tenantId: string): Promise<{ score: number; flag?: string }> {
    if (!email) return { score: 10, flag: 'no_email' };

    // Check for disposable email domains
    const disposableDomains = ['tempmail.org', '10minutemail.com', 'guerrillamail.com'];
    const domain = email.split('@')[1];
    
    if (disposableDomains.includes(domain)) {
      return { score: 40, flag: 'disposable_email' };
    }

    // Check email reputation in past transactions
    const { data: pastTransactions } = await this.supabase
      .from('transactions')
      .select('status')
      .eq('tenant_id', tenantId)
      .like('metadata->>email', email)
      .limit(10);

    if (pastTransactions) {
      const failedCount = pastTransactions.filter((t: any) => t.status === 'failed').length;
      if (failedCount > pastTransactions.length * 0.5) {
        return { score: 25, flag: 'email_high_failure_rate' };
      }
    }

    return { score: 0 };
  }

  private assessGeographicRisk(countryCode: string, tenantId: string): { score: number; flag?: string } {
    // High-risk countries (simplified example)
    const highRiskCountries = ['XX', 'YY']; // Replace with actual high-risk ISO codes
    
    if (highRiskCountries.includes(countryCode)) {
      return { score: 30, flag: 'high_risk_country' };
    }

    return { score: 0 };
  }

  private async assessDeviceRisk(ipAddress: string, userAgent?: string): Promise<{ score: number; flag?: string }> {
    // Check IP reputation (simplified)
    if (ipAddress.startsWith('127.') || ipAddress.startsWith('10.')) {
      return { score: 15, flag: 'local_ip' };
    }

    // Check for suspicious user agents
    if (userAgent && (userAgent.includes('bot') || userAgent.includes('crawler'))) {
      return { score: 35, flag: 'bot_user_agent' };
    }

    return { score: 0 };
  }

  private async logFraudAssessment(
    tenantId: string,
    assessment: FraudAssessment,
    params: FraudDetectionParams
  ): Promise<void> {
    await this.supabase.from('fraud_assessments').insert([{
      tenant_id: tenantId,
      risk_score: assessment.risk_score,
      risk_level: assessment.risk_level,
      flags: assessment.flags,
      recommendation: assessment.recommendation,
      payment_amount: params.amount,
      payment_currency: params.currency,
      customer_email: params.email,
      ip_address: params.ip_address,
      user_agent: params.user_agent,
      country_code: params.country_code,
      details: assessment.details,
    }]);
  }

  private async calculateChargebackRate(tenantId: string, since: string): Promise<number> {
    const { data: transactions } = await this.supabase
      .from('transactions')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    if (!transactions || transactions.length === 0) return 0;

    const chargebacks = transactions.filter(t => t.status === 'chargeback').length;
    return chargebacks / transactions.length;
  }

  private async calculateFailedPaymentRate(tenantId: string, since: string): Promise<number> {
    const { data: transactions } = await this.supabase
      .from('transactions')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    if (!transactions || transactions.length === 0) return 0;

    const failed = transactions.filter(t => t.status === 'failed').length;
    return failed / transactions.length;
  }

  private async calculateReconciliationDrift(tenantId: string): Promise<number> {
    const { data: transactions } = await this.supabase
      .from('transactions')
      .select('reconciliation_status')
      .eq('tenant_id', tenantId)
      .neq('reconciliation_status', 'matched');

    return (transactions?.length || 0) / 100; // Simplified drift calculation
  }

  private async countSuspiciousActivity(tenantId: string, since: string): Promise<number> {
    const { data: activities } = await this.supabase
      .from('suspicious_activities')
      .select('id')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    return activities?.length || 0;
  }

  private calculateOverallFraudScore(metrics: Partial<SecurityMetrics>): number {
    let score = 0;
    
    if (metrics.chargeback_rate && metrics.chargeback_rate > this.config.max_chargeback_rate) {
      score += 30;
    }
    
    if (metrics.reconciliation_drift && metrics.reconciliation_drift > this.config.max_reconciliation_drift) {
      score += 25;
    }
    
    if (metrics.failed_payment_rate && metrics.failed_payment_rate > 0.1) {
      score += 20;
    }
    
    if (metrics.suspicious_activity_count && metrics.suspicious_activity_count > 10) {
      score += 25;
    }

    return Math.min(score, 100);
  }

  private async checkThresholds(tenantId: string, metrics: SecurityMetrics): Promise<void> {
    const alerts = [];

    if (metrics.chargeback_rate > this.config.max_chargeback_rate) {
      alerts.push({
        type: 'high_chargeback_rate',
        value: metrics.chargeback_rate,
        threshold: this.config.max_chargeback_rate,
      });
      reconciliationDiscrepancy(tenantId, 'amount_mismatch');
    }

    if (metrics.reconciliation_drift > this.config.max_reconciliation_drift) {
      alerts.push({
        type: 'high_reconciliation_drift',
        value: metrics.reconciliation_drift,
        threshold: this.config.max_reconciliation_drift,
      });
    }

    if (alerts.length > 0) {
      await publishEvent({
        supabase: this.supabase,
        event: 'payment.security_alert',
        payload: {
          tenant_id: tenantId,
          alerts,
          metrics,
        },
        tenant_id: tenantId,
        location_id: null,
      });
    }
  }

  private async logSuspiciousActivity(
    type: string,
    details: Record<string, unknown>,
    tenantId: string
  ): Promise<void> {
    await this.supabase.from('suspicious_activities').insert([{
      tenant_id: tenantId,
      activity_type: type,
      details,
      severity: 'medium',
    }]);
  }
}

export default PaymentSecurityService;