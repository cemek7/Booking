#!/usr/bin/env node

/**
 * Risk Management Background Jobs
 * Handles automated security monitoring, conflict detection, and cleanup tasks
 */


import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace } from '@opentelemetry/api';

// Initialize Supabase client
const supabase = createServerSupabaseClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

const tracer = trace.getTracer('boka-risk-management-worker');

class RiskManagementWorker {
  constructor() {
    this.setupErrorHandlers();
  }

  setupErrorHandlers() {
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception in Risk Management Worker:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled Rejection in Risk Management Worker:', reason);
      process.exit(1);
    });

    process.on('SIGINT', () => {
      console.log('Risk Management Worker shutting down gracefully...');
      process.exit(0);
    });
  }

  /**
   * Run all risk management tasks
   */
  async runAllTasks() {
    const span = tracer.startSpan('risk_management.run_all_tasks');
    
    try {
      console.log(`🛡️  Starting Risk Management Tasks - ${new Date().toISOString()}`);

      // 1. Cleanup expired locks
      await this.cleanupExpiredLocks();

      // 2. Monitor security metrics for all tenants
      await this.monitorSecurityMetrics();

      // 3. Detect and alert on conflicts
      await this.detectBookingConflicts();

      // 4. Reconciliation monitoring
      await this.monitorReconciliation();

      // 5. Cleanup old security data
      await this.cleanupOldSecurityData();

      console.log(`✅ Risk Management Tasks completed successfully`);

    } catch (error) {
      console.error('❌ Risk Management Tasks failed:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Clean up expired reservation locks
   */
  async cleanupExpiredLocks() {
    const span = tracer.startSpan('risk_management.cleanup_expired_locks');
    
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_reservation_locks');
      
      if (error) {
        throw new Error(`Failed to cleanup expired locks: ${error.message}`);
      }

      const cleanedCount = data || 0;
      console.log(`🧹 Cleaned up ${cleanedCount} expired reservation locks`);
      
      span.setAttribute('cleanup.lock_count', cleanedCount);

    } catch (error) {
      console.error('Failed to cleanup expired locks:', error);
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  }

  /**
   * Monitor security metrics for all tenants
   */
  async monitorSecurityMetrics() {
    const span = tracer.startSpan('risk_management.monitor_security_metrics');

    try {
      // Get all active tenants
      const { data: tenants, error: tenantError } = await supabase
        .from('tenants')
        .select('id, name')
        .eq('status', 'active')
        .limit(100);

      if (tenantError) {
        throw new Error(`Failed to fetch tenants: ${tenantError.message}`);
      }

      if (!tenants || tenants.length === 0) {
        console.log('📊 No active tenants found for security monitoring');
        return;
      }

      console.log(`📊 Monitoring security metrics for ${tenants.length} tenants`);

      for (const tenant of tenants) {
        await this.monitorTenantSecurity(tenant.id, tenant.name);
      }

      span.setAttribute('security.tenants_monitored', tenants.length);

    } catch (error) {
      console.error('Failed to monitor security metrics:', error);
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  }

  /**
   * Monitor security for a specific tenant
   */
  async monitorTenantSecurity(tenantId: string, tenantName: string) {
    try {
      // Calculate security metrics for the past 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // Check chargeback rate
      const chargebackRate = await this.calculateChargebackRate(tenantId, sevenDaysAgo);
      
      // Check failed payment rate
      const failedPaymentRate = await this.calculateFailedPaymentRate(tenantId, sevenDaysAgo);
      
      // Check reconciliation status
      const reconciliationDrift = await this.calculateReconciliationDrift(tenantId);
      
      // Check suspicious activities
      const suspiciousActivityCount = await this.countSuspiciousActivities(tenantId, sevenDaysAgo);

      // Alert on high-risk metrics
      await this.checkSecurityThresholds(tenantId, tenantName, {
        chargeback_rate: chargebackRate,
        failed_payment_rate: failedPaymentRate,
        reconciliation_drift: reconciliationDrift,
        suspicious_activity_count: suspiciousActivityCount,
      });

    } catch (error) {
      console.error(`Failed to monitor security for tenant ${tenantName}:`, error);
    }
  }

  /**
   * Detect booking conflicts across all tenants
   */
  async detectBookingConflicts() {
    const span = tracer.startSpan('risk_management.detect_conflicts');

    try {
      // Look for potential double bookings created in the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { data: recentReservations, error } = await supabase
        .from('reservations')
        .select(`
          id,
          tenant_id,
          start_at,
          end_at,
          staff_id,
          location_id,
          status
        `)
        .gte('created_at', oneHourAgo)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch recent reservations: ${error.message}`);
      }

      if (!recentReservations || recentReservations.length === 0) {
        console.log('🔍 No recent reservations to check for conflicts');
        return;
      }

      console.log(`🔍 Checking ${recentReservations.length} recent reservations for conflicts`);

      let conflictCount = 0;

      for (const reservation of recentReservations) {
        const conflicts = await this.findConflictsForReservation(reservation);
        if (conflicts.length > 0) {
          conflictCount++;
          await this.logConflictAlert(reservation, conflicts);
        }
      }

      console.log(`🚨 Found ${conflictCount} booking conflicts`);
      span.setAttribute('conflicts.detected', conflictCount);

    } catch (error) {
      console.error('Failed to detect booking conflicts:', error);
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  }

  /**
   * Monitor reconciliation status
   */
  async monitorReconciliation() {
    const span = tracer.startSpan('risk_management.monitor_reconciliation');

    try {
      // Check for unreconciled transactions older than 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: unreconciled, error } = await supabase
        .from('transactions')
        .select('id, tenant_id, amount, provider, created_at')
        .eq('reconciliation_status', 'pending')
        .lt('created_at', twentyFourHoursAgo)
        .limit(50);

      if (error) {
        throw new Error(`Failed to fetch unreconciled transactions: ${error.message}`);
      }

      if (unreconciled && unreconciled.length > 0) {
        console.log(`⚠️  Found ${unreconciled.length} unreconciled transactions older than 24 hours`);
        
        // Log alert for unreconciled transactions
        for (const transaction of unreconciled) {
          await this.logReconciliationAlert(transaction);
        }
      }

      span.setAttribute('reconciliation.unreconciled_count', unreconciled?.length || 0);

    } catch (error) {
      console.error('Failed to monitor reconciliation:', error);
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  }

  /**
   * Clean up old security data
   */
  async cleanupOldSecurityData() {
    const span = tracer.startSpan('risk_management.cleanup_security_data');

    try {
      // Clean up old idempotency keys (older than 48 hours)
      const { data: idempotencyCleanup } = await supabase.rpc('cleanup_old_idempotency_keys');
      
      // Clean up old fraud assessments (older than 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const { error: fraudCleanupError } = await supabase
        .from('fraud_assessments')
        .delete()
        .lt('created_at', thirtyDaysAgo);

      if (fraudCleanupError) {
        console.error('Failed to cleanup old fraud assessments:', fraudCleanupError);
      }

      console.log(`🧹 Security data cleanup completed: ${idempotencyCleanup || 0} idempotency keys cleaned`);

    } catch (error) {
      console.error('Failed to cleanup old security data:', error);
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  }

  // Helper methods

  async calculateChargebackRate(tenantId: string, since: string): Promise<number> {
    const { data: transactions } = await supabase
      .from('transactions')
      .select('status')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    if (!transactions || transactions.length === 0) return 0;

    const chargebacks = transactions.filter(t => t.status === 'chargeback').length;
    return chargebacks / transactions.length;
  }

  async calculateFailedPaymentRate(tenantId: string, since: string): Promise<number> {
    const { data: transactions } = await supabase
      .from('transactions')
      .select('status')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    if (!transactions || transactions.length === 0) return 0;

    const failed = transactions.filter(t => t.status === 'failed').length;
    return failed / transactions.length;
  }

  async calculateReconciliationDrift(tenantId: string): Promise<number> {
    const { data: unmatched } = await supabase
      .from('transactions')
      .select('id')
      .eq('tenant_id', tenantId)
      .neq('reconciliation_status', 'matched')
      .limit(100);

    return (unmatched?.length || 0) / 100; // Simplified drift calculation
  }

  async countSuspiciousActivities(tenantId: string, since: string): Promise<number> {
    const { data: activities } = await supabase
      .from('suspicious_activities')
      .select('id')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    return activities?.length || 0;
  }

  async findConflictsForReservation(reservation: any): Promise<any[]> {
    const { data: conflicts } = await supabase
      .from('reservations')
      .select('id, start_at, end_at, staff_id')
      .eq('tenant_id', reservation.tenant_id)
      .neq('id', reservation.id)
      .neq('status', 'cancelled')
      .lt('start_at', reservation.end_at)
      .gt('end_at', reservation.start_at);

    // Filter for same staff conflicts
    const staffConflicts = conflicts?.filter(c => 
      c.staff_id && reservation.staff_id && c.staff_id === reservation.staff_id
    ) || [];

    return staffConflicts;
  }

  async checkSecurityThresholds(tenantId: string, tenantName: string, metrics: any) {
    const alerts = [];

    if (metrics.chargeback_rate > 0.005) { // 0.5%
      alerts.push({
        type: 'high_chargeback_rate',
        value: metrics.chargeback_rate,
        threshold: 0.005,
      });
    }

    if (metrics.failed_payment_rate > 0.1) { // 10%
      alerts.push({
        type: 'high_failed_payment_rate',
        value: metrics.failed_payment_rate,
        threshold: 0.1,
      });
    }

    if (metrics.reconciliation_drift > 0.05) { // 5%
      alerts.push({
        type: 'high_reconciliation_drift',
        value: metrics.reconciliation_drift,
        threshold: 0.05,
      });
    }

    if (alerts.length > 0) {
      console.log(`🚨 Security alerts for ${tenantName}:`, alerts);
      
      // Log to suspicious activities
      await supabase.from('suspicious_activities').insert({
        tenant_id: tenantId,
        activity_type: 'security_threshold_breach',
        details: { alerts, metrics },
        severity: 'high',
      });
    }
  }

  async logConflictAlert(reservation: any, conflicts: any[]) {
    await supabase.from('suspicious_activities').insert({
      tenant_id: reservation.tenant_id,
      activity_type: 'booking_conflict_detected',
      details: {
        reservation_id: reservation.id,
        conflict_count: conflicts.length,
        conflicts: conflicts.map(c => ({
          id: c.id,
          start_at: c.start_at,
          end_at: c.end_at,
        })),
      },
      severity: 'medium',
    });
  }

  async logReconciliationAlert(transaction: any) {
    await supabase.from('suspicious_activities').insert({
      tenant_id: transaction.tenant_id,
      activity_type: 'reconciliation_delay',
      details: {
        transaction_id: transaction.id,
        amount: transaction.amount,
        provider: transaction.provider,
        age_hours: Math.floor((Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60)),
      },
      severity: 'medium',
    });
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = new RiskManagementWorker();
  
  const runOnce = process.argv.includes('--once');
  
  if (runOnce) {
    // Run once and exit
    worker.runAllTasks()
      .then(() => {
        console.log('✅ Risk Management Worker completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Risk Management Worker failed:', error);
        process.exit(1);
      });
  } else {
    // Run continuously every 5 minutes
    console.log('🚀 Starting Risk Management Worker (continuous mode)');
    
    const runContinuously = async () => {
      while (true) {
        try {
          await worker.runAllTasks();
          console.log('⏰ Next run in 5 minutes...');
          await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes
        } catch (error) {
          console.error('❌ Risk Management Worker cycle failed:', error);
          console.log('⏰ Retrying in 1 minute...');
          await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 1 minute retry
        }
      }
    };

    runContinuously().catch((error) => {
      console.error('❌ Risk Management Worker crashed:', error);
      process.exit(1);
    });
  }
}