import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace } from '@opentelemetry/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishEvent } from './eventBus';
import crypto from 'crypto';

export interface SecurityRule {
  id: string;
  rule_name: string;
  rule_type: 'access_control' | 'data_classification' | 'audit_trail' | 'encryption' | 'retention';
  severity: 'low' | 'medium' | 'high' | 'critical';
  condition_sql: string;
  remediation_text: string;
  is_active: boolean;
}

export interface SecurityViolation {
  id: string;
  rule_id: string;
  tenant_id?: string;
  violation_details: Record<string, any>;
  severity: string;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  detected_at: string;
}

export interface PIIDataEntry {
  table_name: string;
  column_name: string;
  data_type: 'email' | 'phone' | 'name' | 'address' | 'financial' | 'medical' | 'other';
  encryption_method?: string;
  retention_days?: number;
  compliance_level: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface SecurityAuditEvent {
  tenant_id?: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  success: boolean;
  failure_reason?: string;
  sensitive_data_accessed?: boolean;
}

export class SecurityAutomationService {
  private supabase: SupabaseClient;
  private tracer = trace.getTracer('boka-security');

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Log security audit event
   */
  async logSecurityEvent(event: SecurityAuditEvent): Promise<{ success: boolean; error?: string }> {
    const span = this.tracer.startSpan('security.log_audit_event');
    
    try {
      const auditEntry = {
        ...event,
        request_id: crypto.randomBytes(16).toString('hex'),
        created_at: new Date().toISOString(),
      };

      const { error } = await this.supabase
        .from('security_audit_log')
        .insert(auditEntry);

      if (error) throw error;

      // Publish security event for real-time monitoring
      await publishEvent({
        supabase: this.supabase,
        event: 'security.audit_logged',
        payload: {
          action: event.action,
          resource_type: event.resource_type,
          success: event.success,
          sensitive_data: event.sensitive_data_accessed || false,
        },
        tenant_id: event.tenant_id || null,
      });

      span.setAttribute('audit.success', true);
      span.setAttribute('audit.action', event.action);
      span.setAttribute('audit.resource_type', event.resource_type);

      return { success: true };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Initialize default security rules
   */
  async initializeSecurityRules(): Promise<{ success: boolean; rulesCreated: number; error?: string }> {
    const span = this.tracer.startSpan('security.initialize_rules');
    
    try {
      const defaultRules: Omit<SecurityRule, 'id'>[] = [
        {
          rule_name: 'Unencrypted PII Data',
          rule_type: 'data_classification',
          severity: 'high',
          condition_sql: `
            SELECT table_name, column_name 
            FROM pii_data_registry 
            WHERE data_type IN ('email', 'phone', 'financial') 
            AND (encryption_method IS NULL OR encryption_method = '')
          `,
          remediation_text: 'Enable encryption for PII columns using column-level encryption',
          is_active: true,
        },
        {
          rule_name: 'Excessive Failed Login Attempts',
          rule_type: 'access_control',
          severity: 'medium',
          condition_sql: `
            SELECT user_id, ip_address, COUNT(*) as failed_attempts
            FROM security_audit_log 
            WHERE action = 'login_attempt' 
            AND success = false 
            AND created_at > now() - interval '15 minutes'
            GROUP BY user_id, ip_address 
            HAVING COUNT(*) >= 5
          `,
          remediation_text: 'Temporarily block IP address and notify user of suspicious activity',
          is_active: true,
        },
        {
          rule_name: 'Privileged Access Without MFA',
          rule_type: 'access_control',
          severity: 'critical',
          condition_sql: `
            SELECT user_id, action 
            FROM security_audit_log 
            WHERE action IN ('admin_login', 'owner_action', 'global_admin_access')
            AND created_at > now() - interval '1 hour'
            AND user_agent NOT LIKE '%mfa_verified%'
          `,
          remediation_text: 'Require MFA for all privileged operations',
          is_active: true,
        },
        {
          rule_name: 'Data Retention Policy Violation',
          rule_type: 'retention',
          severity: 'medium',
          condition_sql: `
            SELECT 'customers' as table_name, id, created_at
            FROM customers 
            WHERE created_at < now() - interval '7 years'
            UNION ALL
            SELECT 'messages' as table_name, id, created_at 
            FROM messages 
            WHERE created_at < now() - interval '2 years'
          `,
          remediation_text: 'Archive or delete data that exceeds retention policy',
          is_active: true,
        },
        {
          rule_name: 'Sensitive Data Access Outside Business Hours',
          rule_type: 'audit_trail',
          severity: 'medium',
          condition_sql: `
            SELECT user_id, action, resource_type, created_at
            FROM security_audit_log 
            WHERE sensitive_data_accessed = true
            AND (
              EXTRACT(hour FROM created_at) < 8 
              OR EXTRACT(hour FROM created_at) > 18
              OR EXTRACT(dow FROM created_at) IN (0, 6)
            )
            AND created_at > now() - interval '24 hours'
          `,
          remediation_text: 'Review business justification for off-hours sensitive data access',
          is_active: true,
        }
      ];

      let rulesCreated = 0;
      for (const rule of defaultRules) {
        try {
          const { error } = await this.supabase
            .from('security_rules')
            .insert(rule);

          if (error && !error.message.includes('duplicate')) {
            console.warn(`Failed to create rule ${rule.rule_name}:`, error);
          } else {
            rulesCreated++;
          }
        } catch (e) {
          console.warn(`Error creating rule ${rule.rule_name}:`, e);
        }
      }

      span.setAttribute('rules.created', rulesCreated);
      return { success: true, rulesCreated };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, rulesCreated: 0, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Run security rule evaluation
   */
  async evaluateSecurityRules(): Promise<{ 
    success: boolean; 
    rulesEvaluated: number; 
    violationsFound: number; 
    error?: string; 
  }> {
    const span = this.tracer.startSpan('security.evaluate_rules');
    
    try {
      // Get active security rules
      const { data: rules, error: rulesError } = await this.supabase
        .from('security_rules')
        .select('*')
        .eq('is_active', true);

      if (rulesError) throw rulesError;

      let rulesEvaluated = 0;
      let violationsFound = 0;

      for (const rule of rules || []) {
        try {
          // Note: In production, you'd want to use a more secure way to execute
          // custom SQL, such as predefined stored procedures or a query builder
          // For now, we'll simulate violation detection
          
          const mockViolations = await this.simulateRuleEvaluation(rule);
          
          if (mockViolations.length > 0) {
            await this.createSecurityViolations(rule, mockViolations);
            violationsFound += mockViolations.length;
          }

          rulesEvaluated++;

        } catch (error) {
          console.warn(`Error evaluating rule ${rule.rule_name}:`, error);
        }
      }

      span.setAttribute('rules.evaluated', rulesEvaluated);
      span.setAttribute('violations.found', violationsFound);

      // Publish security scan completed event
      await publishEvent({
        supabase: this.supabase,
        event: 'security.rules_evaluated',
        payload: {
          rules_evaluated: rulesEvaluated,
          violations_found: violationsFound,
        },
        tenant_id: null,
      });

      return { success: true, rulesEvaluated, violationsFound };

    } catch (error) {
      span.recordException(error as Error);
      return { 
        success: false, 
        rulesEvaluated: 0, 
        violationsFound: 0, 
        error: (error as Error).message 
      };
    } finally {
      span.end();
    }
  }

  /**
   * Create security violations from rule evaluation
   */
  private async createSecurityViolations(
    rule: SecurityRule, 
    violationData: Array<Record<string, any>>
  ): Promise<void> {
    for (const data of violationData) {
      try {
        const violation = {
          rule_id: rule.id,
          tenant_id: data.tenant_id || null,
          violation_details: data,
          severity: rule.severity,
          status: 'open' as const,
          detected_at: new Date().toISOString(),
        };

        await this.supabase
          .from('security_violations')
          .insert(violation);

        // Publish violation detected event
        await publishEvent({
          supabase: this.supabase,
          event: 'security.violation_detected',
          payload: {
            rule_name: rule.rule_name,
            severity: rule.severity,
            violation_id: violation.rule_id,
          },
          tenant_id: data.tenant_id || null,
        });

      } catch (error) {
        console.warn('Error creating security violation:', error);
      }
    }
  }

  /**
   * Simulate rule evaluation (replace with actual SQL execution in production)
   */
  private async simulateRuleEvaluation(rule: SecurityRule): Promise<Array<Record<string, any>>> {
    // This is a simplified simulation - in production you'd execute the actual SQL
    // against your database with proper sanitization and security
    
    switch (rule.rule_name) {
      case 'Unencrypted PII Data':
        // Check for unencrypted PII columns
        const { data: piiData } = await this.supabase
          .from('pii_data_registry')
          .select('*')
          .in('data_type', ['email', 'phone', 'financial'])
          .or('encryption_method.is.null,encryption_method.eq.');
        
        return (piiData || []).map((row: any) => ({
          table_name: row.table_name,
          column_name: row.column_name,
          data_type: row.data_type,
        }));

      case 'Excessive Failed Login Attempts':
        // Check for failed login patterns
        const { data: failedLogins } = await this.supabase
          .from('security_audit_log')
          .select('user_id, ip_address')
          .eq('action', 'login_attempt')
          .eq('success', false)
          .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());
        
        // Group by user_id and ip_address, count failures
        const loginGroups = (failedLogins || []).reduce((acc: Record<string, number>, login: any) => {
          const key = `${login.user_id}-${login.ip_address}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        return Object.entries(loginGroups)
          .filter(([_key, count]: [string, unknown]) => (count as number) >= 5)
          .map(([key, count]) => {
            const [user_id, ip_address] = key.split('-');
            return { user_id, ip_address, failed_attempts: count };
          });

      default:
        return [];
    }
  }

  /**
   * Register PII data for compliance tracking
   */
  async registerPIIData(entries: PIIDataEntry[]): Promise<{ success: boolean; registered: number; error?: string }> {
    const span = this.tracer.startSpan('security.register_pii');
    
    try {
      let registered = 0;
      
      for (const entry of entries) {
        const { error } = await this.supabase
          .from('pii_data_registry')
          .upsert({
            ...entry,
            last_scan_at: new Date().toISOString(),
          }, {
            onConflict: 'table_name,column_name',
          });

        if (error) {
          console.warn(`Failed to register PII data for ${entry.table_name}.${entry.column_name}:`, error);
        } else {
          registered++;
        }
      }

      span.setAttribute('pii.registered', registered);
      return { success: true, registered };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, registered: 0, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Perform automated PII data scan
   */
  async scanPIIData(): Promise<{ 
    success: boolean; 
    tablesScanned: number; 
    piiFound: number; 
    error?: string; 
  }> {
    const span = this.tracer.startSpan('security.scan_pii');
    
    try {
      // Tables to scan for PII (in production, you'd get this dynamically)
      const tablesToScan = [
        'customers',
        'messages', 
        'reservations',
        'transactions',
        'tenant_users',
      ];

      let tablesScanned = 0;
      let piiFound = 0;
      const piiEntries: PIIDataEntry[] = [];

      for (const tableName of tablesToScan) {
        try {
          // Get table schema information
          const { data: columns } = await this.supabase
            .from('information_schema.columns')
            .select('column_name, data_type')
            .eq('table_name', tableName)
            .eq('table_schema', 'public');

          if (!columns) continue;

          for (const column of columns) {
            const columnName = column.column_name;
            
            // Check if column name suggests PII
            let dataType: PIIDataEntry['data_type'] | null = null;
            
            if (/email/i.test(columnName)) {
              dataType = 'email';
            } else if (/phone|mobile|tel/i.test(columnName)) {
              dataType = 'phone';
            } else if (/name|first|last|full/i.test(columnName)) {
              dataType = 'name';
            } else if (/address|street|city|zip|postal/i.test(columnName)) {
              dataType = 'address';
            } else if (/card|payment|bank|account/i.test(columnName)) {
              dataType = 'financial';
            }

            if (dataType) {
              piiEntries.push({
                table_name: tableName,
                column_name: columnName,
                data_type: dataType,
                compliance_level: dataType === 'financial' ? 'restricted' : 'confidential',
                retention_days: dataType === 'financial' ? 2555 : 1825, // 7 years for financial, 5 for others
              });
              piiFound++;
            }
          }

          tablesScanned++;

        } catch (error) {
          console.warn(`Error scanning table ${tableName}:`, error);
        }
      }

      // Register found PII data
      if (piiEntries.length > 0) {
        await this.registerPIIData(piiEntries);
      }

      span.setAttribute('scan.tables', tablesScanned);
      span.setAttribute('scan.pii_found', piiFound);

      return { success: true, tablesScanned, piiFound };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, tablesScanned: 0, piiFound: 0, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Generate security compliance report
   */
  async generateComplianceReport(): Promise<{
    success: boolean;
    report?: {
      pii_summary: Record<string, number>;
      open_violations: number;
      critical_violations: number;
      audit_events_last_24h: number;
      encryption_coverage: number;
    };
    error?: string;
  }> {
    const span = this.tracer.startSpan('security.compliance_report');
    
    try {
      // PII summary by data type
      const { data: piiSummary } = await this.supabase
        .from('pii_data_registry')
        .select('data_type');
      
      const piiGrouped = (piiSummary || []).reduce((acc: Record<string, number>, item: any) => {
        acc[item.data_type] = (acc[item.data_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Open violations count
      const { count: openViolations } = await this.supabase
        .from('security_violations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open');

      // Critical violations count  
      const { count: criticalViolations } = await this.supabase
        .from('security_violations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open')
        .eq('severity', 'critical');

      // Audit events in last 24 hours
      const { count: auditEvents24h } = await this.supabase
        .from('security_audit_log')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      // Encryption coverage
      const { data: piiData } = await this.supabase
        .from('pii_data_registry')
        .select('encryption_method');
      
      const encryptedCount = (piiData || []).filter(
        (item: any) => item.encryption_method && item.encryption_method !== ''
      ).length;
      
      const encryptionCoverage = piiData?.length 
        ? Math.round((encryptedCount / piiData.length) * 100) 
        : 0;

      const report = {
        pii_summary: piiGrouped,
        open_violations: openViolations || 0,
        critical_violations: criticalViolations || 0,
        audit_events_last_24h: auditEvents24h || 0,
        encryption_coverage: encryptionCoverage,
      };

      span.setAttribute('report.open_violations', report.open_violations);
      span.setAttribute('report.encryption_coverage', report.encryption_coverage);

      return { success: true, report };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }
}

export default SecurityAutomationService;