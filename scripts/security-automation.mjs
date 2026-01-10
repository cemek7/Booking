#!/usr/bin/env node

/**
 * Security Automation Script
 * 
 * Runs automated security scans, rule evaluations, and compliance monitoring.
 * Designed to run as a scheduled job (e.g., via cron).
 * 
 * Usage:
 * node scripts/security-automation.mjs [--scan-pii] [--evaluate-rules] [--init-rules] [--compliance-report]
 * 
 * Environment Variables:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 * - SECURITY_SCAN_INTERVAL_HOURS: How often to run security scans
 * - ALERT_WEBHOOK_URL: Webhook URL for critical security alerts
 */

import { createServerSupabaseClient } from '../src/lib/supabaseClient';
import SecurityAutomationService from '../src/lib/securityAutomation.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('security-automation');

// Configuration
const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  scanIntervalHours: parseInt(process.env.SECURITY_SCAN_INTERVAL_HOURS || '24'),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
};

// Parse command line arguments
const args = {
  scanPii: process.argv.includes('--scan-pii'),
  evaluateRules: process.argv.includes('--evaluate-rules'),
  initRules: process.argv.includes('--init-rules'),
  complianceReport: process.argv.includes('--compliance-report'),
  all: process.argv.includes('--all') || process.argv.length === 2, // Default to all if no specific args
};

console.log('Security Automation Configuration:', {
  scanIntervalHours: config.scanIntervalHours,
  hasAlertWebhook: !!config.alertWebhookUrl,
  operations: args,
});

async function main() {
  const span = tracer.startSpan('security_automation.main');
  
  try {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    // Initialize Supabase client
    const supabase = createServerSupabaseClient(config.supabaseUrl, config.supabaseServiceKey);
    
    // Initialize security service
    const securityService = new SecurityAutomationService(supabase);

    console.log('🔐 Security Automation starting...');

    const results = {
      rulesInitialized: 0,
      rulesEvaluated: 0,
      violationsFound: 0,
      piiTablesScanned: 0,
      piiFound: 0,
      complianceReport: null,
    };

    // Initialize security rules if requested
    if (args.initRules || args.all) {
      console.log('🔧 Initializing security rules...');
      const initResult = await securityService.initializeSecurityRules();
      
      if (initResult.success) {
        results.rulesInitialized = initResult.rulesCreated;
        console.log(`✅ Security rules initialized: ${initResult.rulesCreated} rules created`);
      } else {
        console.error(`❌ Failed to initialize security rules: ${initResult.error}`);
      }
    }

    // Run PII data scan if requested
    if (args.scanPii || args.all) {
      console.log('🔍 Running PII data scan...');
      const scanResult = await securityService.scanPIIData();
      
      if (scanResult.success) {
        results.piiTablesScanned = scanResult.tablesScanned;
        results.piiFound = scanResult.piiFound;
        console.log(`✅ PII scan completed: ${scanResult.tablesScanned} tables scanned, ${scanResult.piiFound} PII columns found`);
      } else {
        console.error(`❌ PII scan failed: ${scanResult.error}`);
      }
    }

    // Evaluate security rules if requested
    if (args.evaluateRules || args.all) {
      console.log('⚖️ Evaluating security rules...');
      const evalResult = await securityService.evaluateSecurityRules();
      
      if (evalResult.success) {
        results.rulesEvaluated = evalResult.rulesEvaluated;
        results.violationsFound = evalResult.violationsFound;
        console.log(`✅ Security rules evaluation completed: ${evalResult.rulesEvaluated} rules evaluated, ${evalResult.violationsFound} violations found`);
        
        // Send alerts for critical violations
        if (evalResult.violationsFound > 0) {
          await sendSecurityAlert({
            type: 'violations_detected',
            count: evalResult.violationsFound,
            rulesEvaluated: evalResult.rulesEvaluated,
          });
        }
      } else {
        console.error(`❌ Security rules evaluation failed: ${evalResult.error}`);
      }
    }

    // Generate compliance report if requested
    if (args.complianceReport || args.all) {
      console.log('📊 Generating compliance report...');
      const reportResult = await securityService.generateComplianceReport();
      
      if (reportResult.success && reportResult.report) {
        results.complianceReport = reportResult.report;
        console.log('✅ Compliance report generated:');
        console.log(`   • PII Summary:`, reportResult.report.pii_summary);
        console.log(`   • Open Violations: ${reportResult.report.open_violations}`);
        console.log(`   • Critical Violations: ${reportResult.report.critical_violations}`);
        console.log(`   • Audit Events (24h): ${reportResult.report.audit_events_last_24h}`);
        console.log(`   • Encryption Coverage: ${reportResult.report.encryption_coverage}%`);
        
        // Send alert for poor compliance metrics
        if (reportResult.report.critical_violations > 0 || reportResult.report.encryption_coverage < 80) {
          await sendSecurityAlert({
            type: 'compliance_warning',
            criticalViolations: reportResult.report.critical_violations,
            encryptionCoverage: reportResult.report.encryption_coverage,
          });
        }
      } else {
        console.error(`❌ Compliance report failed: ${reportResult.error}`);
      }
    }

    // Log security automation event
    await securityService.logSecurityEvent({
      action: 'security_automation_run',
      resource_type: 'security_system',
      success: true,
      sensitive_data_accessed: args.scanPii || args.all,
    });

    console.log('🏁 Security Automation completed:', results);

    span.setAttribute('rules.initialized', results.rulesInitialized);
    span.setAttribute('rules.evaluated', results.rulesEvaluated);
    span.setAttribute('violations.found', results.violationsFound);
    span.setAttribute('pii.tables_scanned', results.piiTablesScanned);
    span.setAttribute('pii.found', results.piiFound);

  } catch (error) {
    span.recordException(error);
    console.error('❌ Security Automation fatal error:', error);
    
    // Send critical error alert
    await sendSecurityAlert({
      type: 'automation_error',
      error: error.message,
    });
    
    process.exit(1);
  } finally {
    span.end();
  }
}

async function sendSecurityAlert(alert) {
  if (!config.alertWebhookUrl) {
    console.log(`🚨 Security Alert (no webhook configured):`, alert);
    return;
  }

  try {
    const response = await fetch(config.alertWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'boka-security-automation',
        alert,
      }),
    });

    if (response.ok) {
      console.log(`📤 Security alert sent: ${alert.type}`);
    } else {
      console.error(`❌ Failed to send security alert: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ Error sending security alert:', error);
  }
}

// Sample cron schedule comments for reference:
// Run daily at 2 AM: 0 2 * * *
// Run every 6 hours: 0 */6 * * *
// Run weekly on Sunday at midnight: 0 0 * * 0

console.log(`
📅 Suggested cron schedules:
   Daily security scan:     0 2 * * * node scripts/security-automation.mjs --all
   PII scan only (weekly):  0 3 * * 0 node scripts/security-automation.mjs --scan-pii
   Rules evaluation (4x/day): 0 */6 * * * node scripts/security-automation.mjs --evaluate-rules
   Compliance report (weekly): 0 4 * * 0 node scripts/security-automation.mjs --compliance-report
`);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📤 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📤 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the automation
main().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});