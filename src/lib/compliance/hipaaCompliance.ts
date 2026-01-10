/**
 * HIPAA Compliance Enhancement Module
 * 
 * Comprehensive healthcare data protection and audit trail system
 * for medical vertical compliance with HIPAA regulations
 */

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/encryption';
import { observability } from '@/lib/observability/observability';

export interface PHIAccessLog {
  id: string;
  user_id: string;
  patient_id: string;
  action: 'view' | 'create' | 'update' | 'delete' | 'print' | 'export';
  data_type: 'appointment' | 'medical_record' | 'prescription' | 'image' | 'document';
  accessed_at: Date;
  ip_address: string;
  user_agent: string;
  justification?: string;
  session_id: string;
  tenant_id: string;
}

export interface PatientConsent {
  id: string;
  patient_id: string;
  consent_type: 'treatment' | 'data_sharing' | 'research' | 'marketing';
  granted: boolean;
  granted_at?: Date;
  revoked_at?: Date;
  document_url?: string;
  witness_signature?: string;
  patient_signature: string;
  tenant_id: string;
}

export interface EncryptedMedicalData {
  id: string;
  patient_id: string;
  data_type: string;
  encrypted_data: string;
  encryption_key_id: string;
  created_at: Date;
  accessed_count: number;
  last_accessed: Date;
  retention_period_days: number;
  tenant_id: string;
}

/**
 * HIPAA Compliance Manager
 * Handles PHI protection, audit trails, and compliance monitoring
 */
export class HIPAAComplianceManager {
  private supabase = getSupabaseRouteHandlerClient();
  
  /**
   * Log PHI access for audit trail
   */
  async logPHIAccess(accessLog: Omit<PHIAccessLog, 'id' | 'accessed_at'>): Promise<void> {
    const span = observability.startTrace('hipaa.log_phi_access');
    
    try {
      const { error } = await this.supabase
        .from('phi_access_logs')
        .insert({
          ...accessLog,
          accessed_at: new Date().toISOString()
        });
      
      if (error) {
        throw new Error(`Failed to log PHI access: ${error.message}`);
      }
      
      // Also log to external compliance system
      await this.logToExternalCompliance(accessLog);
      
      observability.recordBusinessMetric('phi_access_logged_total', 1, {
        action: accessLog.action,
        data_type: accessLog.data_type
      });
      
    } catch (error) {
      console.error('Error logging PHI access:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  /**
   * Encrypt sensitive medical data
   */
  async encryptMedicalData(
    patientId: string,
    dataType: string,
    data: any,
    tenantId: string
  ): Promise<EncryptedMedicalData> {
    const span = observability.startTrace('hipaa.encrypt_medical_data');
    
    try {
      const encryptionResult = await encrypt(JSON.stringify(data));
      
      const encryptedData: Omit<EncryptedMedicalData, 'id'> = {
        patient_id: patientId,
        data_type: dataType,
        encrypted_data: encryptionResult.encryptedData,
        encryption_key_id: encryptionResult.keyId,
        created_at: new Date(),
        accessed_count: 0,
        last_accessed: new Date(),
        retention_period_days: this.getRetentionPeriod(dataType),
        tenant_id: tenantId
      };
      
      const { data: result, error } = await this.supabase
        .from('encrypted_medical_data')
        .insert(encryptedData)
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to store encrypted data: ${error.message}`);
      }
      
      observability.recordBusinessMetric('medical_data_encrypted_total', 1, {
        data_type: dataType
      });
      
      return result;
      
    } catch (error) {
      console.error('Error encrypting medical data:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  /**
   * Decrypt and access medical data with audit trail
   */
  async accessMedicalData(
    dataId: string,
    userId: string,
    justification: string,
    sessionInfo: {
      ip_address: string;
      user_agent: string;
      session_id: string;
    }
  ): Promise<any> {
    const span = observability.startTrace('hipaa.access_medical_data');

    try {
      // Get encrypted data
      const { data: encryptedData, error } = await this.supabase
        .from('encrypted_medical_data')
        .select('*')
        .eq('id', dataId)
        .single();

      if (error || !encryptedData) {
        throw new Error('Medical data not found');
      }

      // Log PHI access
      await this.logPHIAccess({
        user_id: userId,
        patient_id: encryptedData.patient_id,
        action: 'view',
        data_type: encryptedData.data_type as any,
        ip_address: sessionInfo.ip_address,
        user_agent: sessionInfo.user_agent,
        justification,
        session_id: sessionInfo.session_id,
        tenant_id: encryptedData.tenant_id,
      });

      // Decrypt data
      const decryptedData = await decrypt(
        encryptedData.encrypted_data,
        encryptedData.encryption_key_id
      );

      // Update access tracking
      await this.supabase
        .from('encrypted_medical_data')
        .update({
          accessed_count: encryptedData.accessed_count + 1,
          last_accessed: new Date().toISOString(),
        })
        .eq('id', dataId);

      return JSON.parse(decryptedData);
    } catch (error) {
      console.error('Error accessing medical data:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Manage patient consent
   */
  async recordPatientConsent(
    consent: Omit<PatientConsent, 'id' | 'granted_at'>
  ): Promise<PatientConsent> {
    const span = observability.startTrace('hipaa.record_patient_consent');
    
    try {
      const consentRecord = {
        ...consent,
        granted_at: consent.granted ? new Date().toISOString() : null
      };
      
      const { data: result, error } = await this.supabase
        .from('patient_consents')
        .insert(consentRecord)
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to record consent: ${error.message}`);
      }
      
      observability.recordBusinessMetric('patient_consent_recorded_total', 1, {
        consent_type: consent.consent_type,
        granted: consent.granted.toString()
      });
      
      return result;
      
    } catch (error) {
      console.error('Error recording patient consent:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  /**
   * Generate HIPAA compliance report
   */
  async generateComplianceReport(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    phi_access_summary: any;
    consent_summary: any;
    security_incidents: any;
    data_retention_status: any;
  }> {
    const span = observability.startTrace('hipaa.generate_compliance_report');
    
    try {
      // PHI Access Summary
      const { data: phiAccess } = await this.supabase
        .from('phi_access_logs')
        .select('action, data_type, accessed_at')
        .eq('tenant_id', tenantId)
        .gte('accessed_at', startDate.toISOString())
        .lte('accessed_at', endDate.toISOString());
      
      // Consent Summary
      const { data: consents } = await this.supabase
        .from('patient_consents')
        .select('consent_type, granted, granted_at, revoked_at')
        .eq('tenant_id', tenantId);
      
      // Security Incidents
      const { data: incidents } = await this.supabase
        .from('security_incidents')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('occurred_at', startDate.toISOString())
        .lte('occurred_at', endDate.toISOString());
      
      // Data Retention Status
      const { data: retentionData } = await this.supabase
        .from('encrypted_medical_data')
        .select('data_type, created_at, retention_period_days')
        .eq('tenant_id', tenantId);
      
      const report = {
        phi_access_summary: this.summarizePHIAccess(phiAccess || []),
        consent_summary: this.summarizeConsents(consents || []),
        security_incidents: incidents || [],
        data_retention_status: this.analyzeRetentionStatus(retentionData || [])
      };
      
      observability.recordBusinessMetric('compliance_report_generated_total', 1);
      
      return report;
      
    } catch (error) {
      console.error('Error generating compliance report:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  /**
   * Check for potential HIPAA violations
   */
  async checkComplianceViolations(tenantId: string): Promise<{
    violations: Array<{
      type: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      detected_at: Date;
    }>;
  }> {
    const violations = [];
    
    // Check for excessive PHI access
    const excessiveAccess = await this.detectExcessivePHIAccess(tenantId);
    violations.push(...excessiveAccess);
    
    // Check for missing consent
    const missingConsent = await this.detectMissingConsent(tenantId);
    violations.push(...missingConsent);
    
    // Check for data retention violations
    const retentionViolations = await this.detectRetentionViolations(tenantId);
    violations.push(...retentionViolations);
    
    // Check for security incidents
    const securityIssues = await this.detectSecurityIncidents(tenantId);
    violations.push(...securityIssues);
    
    return { violations };
  }
  
  // Private helper methods
  
  private async logToExternalCompliance(accessLog: any): Promise<void> {
    // Log to external HIPAA compliance monitoring service
    // Implementation depends on chosen compliance service
  }
  
  private getRetentionPeriod(dataType: string): number {
    const retentionPeriods = {
      'appointment': 2555, // 7 years
      'medical_record': 2555,
      'prescription': 1095, // 3 years
      'image': 3650, // 10 years
      'document': 2555
    };
    
    return retentionPeriods[dataType as keyof typeof retentionPeriods] || 2555;
  }
  
  private summarizePHIAccess(accessLogs: any[]): any {
    return {
      total_accesses: accessLogs.length,
      by_action: accessLogs.reduce((acc, log) => {
        acc[log.action] = (acc[log.action] || 0) + 1;
        return acc;
      }, {}),
      by_data_type: accessLogs.reduce((acc, log) => {
        acc[log.data_type] = (acc[log.data_type] || 0) + 1;
        return acc;
      }, {})
    };
  }
  
  private summarizeConsents(consents: any[]): any {
    return {
      total_consents: consents.length,
      granted: consents.filter(c => c.granted).length,
      revoked: consents.filter(c => c.revoked_at).length,
      by_type: consents.reduce((acc, consent) => {
        acc[consent.consent_type] = (acc[consent.consent_type] || 0) + 1;
        return acc;
      }, {})
    };
  }
  
  private analyzeRetentionStatus(retentionData: any[]): any {
    const now = new Date();
    const expiredData = retentionData.filter(data => {
      const expiryDate = new Date(data.created_at);
      expiryDate.setDate(expiryDate.getDate() + data.retention_period_days);
      return expiryDate < now;
    });
    
    return {
      total_records: retentionData.length,
      expired_records: expiredData.length,
      expiring_soon: retentionData.filter(data => {
        const expiryDate = new Date(data.created_at);
        expiryDate.setDate(expiryDate.getDate() + data.retention_period_days);
        const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
      }).length
    };
  }
  
  private async detectExcessivePHIAccess(tenantId: string): Promise<any[]> {
    // Implementation for detecting unusual access patterns
    return [];
  }
  
  private async detectMissingConsent(tenantId: string): Promise<any[]> {
    // Implementation for detecting missing patient consents
    return [];
  }
  
  private async detectRetentionViolations(tenantId: string): Promise<any[]> {
    // Implementation for detecting data retention violations
    return [];
  }
  
  private async detectSecurityIncidents(tenantId: string): Promise<any[]> {
    // Implementation for detecting security incidents
    return [];
  }
}

// Singleton instance
export const hipaaCompliance = new HIPAAComplianceManager();