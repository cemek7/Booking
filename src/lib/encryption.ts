/**
 * Enhanced Encryption Module for HIPAA Compliance
 * 
 * Provides enterprise-grade encryption for PHI (Protected Health Information)
 * with key rotation, audit trails, and compliance monitoring
 */

import { webcrypto } from 'crypto';
import { observability } from '@/lib/observability/observability';

export interface EncryptionResult {
  encryptedData: string;
  keyId: string;
  algorithm: string;
  iv: string;
  tag: string;
}

export interface DecryptionRequest {
  encryptedData: string;
  keyId: string;
  algorithm: string;
  iv: string;
  tag: string;
}

export interface EncryptionKey {
  id: string;
  key: CryptoKey;
  purpose: 'phi' | 'general' | 'backup';
  type: 'master' | 'standard';
  createdAt: Date;
  status: 'active' | 'deprecated' | 'revoked';
  version: number;
}

/**
 * Enterprise Encryption Manager with HIPAA compliance features
 */
export class EnterpriseEncryptionManager {
  private keys: Map<string, EncryptionKey> = new Map();
  private activeKeyId: string | null = null;
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyRotationIntervalMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  
  constructor() {
    this.initializeKeys();
    this.scheduleKeyRotation();
  }
  
  /**
   * Encrypt data with current active key
   */
  async encrypt(data: string, purpose: 'phi' | 'general' = 'phi'): Promise<EncryptionResult> {
    const span = await observability.startTrace('encryption.encrypt_data');
    
    try {
      const key = this.getActiveKey(purpose);
      if (!key) {
        throw new Error('No active encryption key available');
      }
      
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(data);

      const encryptedData = await webcrypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: encoder.encode(key.id),
        },
        key.key as CryptoKey,
        encodedData
      );
      
      const result: EncryptionResult = {
        encryptedData: Buffer.from(encryptedData).toString('hex'),
        keyId: key.id,
        algorithm: this.algorithm,
        iv: Buffer.from(iv).toString('hex'),
        tag: '' // Tag is included in the encryptedData in Web Crypto API
      };
      
      // Log encryption event
      await this.logEncryptionEvent('encrypt', key.id, purpose);
      
      observability.recordBusinessMetric('data_encrypted_total', 1, {
        purpose,
        key_id: key.id
      });
      
      return result;
      
    } catch (error) {
      console.error('Encryption error:', error);
      span?.recordException(error as Error);
      throw error;
    } finally {
      span?.end();
    }
  }
  
  /**
   * Decrypt data with specified key
   */
  async decrypt(request: DecryptionRequest): Promise<string> {
    const span = await observability.startTrace('encryption.decrypt_data');
    
    try {
      const key = this.keys.get(request.keyId);
      if (!key) {
        throw new Error(`Encryption key not found: ${request.keyId}`);
      }
      
      if (key.status === 'revoked') {
        throw new Error(`Cannot decrypt with revoked key: ${request.keyId}`);
      }
      
      const decoder = new TextDecoder();
      const iv = Buffer.from(request.iv, 'hex');
      const encryptedData = Buffer.from(request.encryptedData, 'hex');

      const decryptedData = await webcrypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: new TextEncoder().encode(key.id),
        },
        key.key as CryptoKey,
        encryptedData
      );
      
      const decryptedText = decoder.decode(decryptedData);
      
      // Log decryption event
      await this.logEncryptionEvent('decrypt', request.keyId, key.purpose);
      
      observability.recordBusinessMetric('data_decrypted_total', 1, {
        key_id: request.keyId,
        purpose: key.purpose
      });
      
      return decryptedText;
      
    } catch (error) {
      console.error('Decryption error:', error);
      span?.recordException(error as Error);
      throw error;
    } finally {
      span?.end();
    }
  }
  
  /**
   * Generate new encryption key
   */
  private async generateKey(purpose: 'phi' | 'general' | 'backup', type: 'master' | 'standard' = 'standard'): Promise<EncryptionKey> {
    const keyId = `key_${new Date().getTime()}`;
    const key = await webcrypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );

    return {
      id: keyId,
      key: key,
      purpose: purpose,
      type: type,
      createdAt: new Date(),
      status: 'active',
      version: 1,
    };
  }

  async generateNewKey(purpose: 'phi' | 'general' | 'backup'): Promise<string> {
    const newKey = await this.generateKey(purpose);
    this.keys.set(newKey.id, newKey);
    await this.logEncryptionEvent('generate', newKey.id, purpose);
    return newKey.id;
  }

  /**
   * Rotate encryption keys
   */
  async rotateKeys(): Promise<void> {
    const span = await observability.startTrace('encryption.rotate_keys');
    
    try {
      console.log('Starting key rotation...');
      
      // Deprecate current active key
      if (this.activeKeyId) {
        const currentKey = this.keys.get(this.activeKeyId);
        if (currentKey) {
          currentKey.status = 'deprecated';
          this.keys.set(this.activeKeyId, currentKey);
          await this.logEncryptionEvent('key_deprecated', this.activeKeyId, currentKey.purpose);
        }
      }
      
      // Generate new active key
      const newKeyId = await this.generateNewKey('phi');
      this.activeKeyId = newKeyId;
      
      // Schedule old key revocation (keep for 90 days for decryption)
      setTimeout(() => {
        this.revokeOldKeys();
      }, 90 * 24 * 60 * 60 * 1000); // 90 days
      
      observability.recordBusinessMetric('encryption_keys_rotated_total', 1);
      
      console.log(`Key rotation completed. New active key: ${newKeyId}`);
      
    } catch (error) {
      console.error('Key rotation error:', error);
      span?.recordException(error as Error);
      throw error;
    } finally {
      span?.end();
    }
  }
  
  /**
   * Get key status and information
   */
  getKeyStatus(): {
    active_key: string | null;
    total_keys: number;
    keys_by_status: Record<string, number>;
    keys_by_purpose: Record<string, number>;
  } {
    const keysByStatus: Record<string, number> = {};
    const keysByPurpose: Record<string, number> = {};
    
    this.keys.forEach(key => {
      keysByStatus[key.status] = (keysByStatus[key.status] || 0) + 1;
      keysByPurpose[key.purpose] = (keysByPurpose[key.purpose] || 0) + 1;
    });
    
    return {
      active_key: this.activeKeyId,
      total_keys: this.keys.size,
      keys_by_status: keysByStatus,
      keys_by_purpose: keysByPurpose
    };
  }
  
  /**
   * Validate encryption strength and compliance
   */
  async validateCompliance(): Promise<{
    compliant: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Check key age
    const activeKey = this.activeKeyId ? this.keys.get(this.activeKeyId) : null;
    if (activeKey) {
      const keyAge = Date.now() - activeKey.created_at.getTime();
      if (keyAge > this.keyRotationIntervalMs) {
        issues.push('Active encryption key is beyond rotation interval');
        recommendations.push('Perform key rotation immediately');
      }
    } else {
      issues.push('No active encryption key found');
      recommendations.push('Generate new encryption key');
    }
    
    // Check algorithm strength
    if (this.algorithm !== 'aes-256-gcm') {
      issues.push('Encryption algorithm does not meet HIPAA requirements');
      recommendations.push('Upgrade to AES-256-GCM encryption');
    }
    
    // Check deprecated key count
    const deprecatedKeys = Array.from(this.keys.values()).filter(k => k.status === 'deprecated');
    if (deprecatedKeys.length > 5) {
      issues.push('Too many deprecated keys in system');
      recommendations.push('Revoke old deprecated keys');
    }
    
    return {
      compliant: issues.length === 0,
      issues,
      recommendations
    };
  }
  
  // Private methods
  
  private initializeKeys(): void {
    // Initialize with a default key if none exist
    if (this.keys.size === 0) {
      this.generateNewKey('phi');
    }
  }
  
  private scheduleKeyRotation(): void {
    // Schedule automatic key rotation
    setInterval(() => {
      this.rotateKeys().catch(error => {
        console.error('Scheduled key rotation failed:', error);
      });
    }, this.keyRotationIntervalMs);
  }
  
  private getActiveKey(purpose: 'phi' | 'general' | 'backup'): EncryptionKey | null {
    if (purpose === 'phi' && this.activeKeyId) {
      return this.keys.get(this.activeKeyId) || null;
    }
    
    // Find active key for other purposes
    for (const key of this.keys.values()) {
      if (key.purpose === purpose && key.status === 'active') {
        return key;
      }
    }
    
    return null;
  }
  
  private async revokeOldKeys(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    for (const [keyId, key] of this.keys.entries()) {
      if (key.status === 'deprecated' && key.created_at < ninetyDaysAgo) {
        key.status = 'revoked';
        this.keys.set(keyId, key);
        await this.logEncryptionEvent('key_revoked', keyId, key.purpose);
      }
    }
  }
  
  private async logEncryptionEvent(
    action: string,
    keyId: string,
    purpose: string
  ): Promise<void> {
    // Log to compliance system
    console.log(`Encryption event: ${action} for key ${keyId} (${purpose})`);
    
    // In production, this would log to your compliance monitoring system
    // await complianceLogger.log({
    //   event: action,
    //   key_id: keyId,
    //   purpose,
    //   timestamp: new Date(),
    //   user_id: getCurrentUserId()
    // });
  }
}

// Singleton instance
export const encryptionManager = new EnterpriseEncryptionManager();

// Convenience functions that match the existing interface
export async function encrypt(data: string): Promise<EncryptionResult> {
  return encryptionManager.encrypt(data, 'phi');
}

export async function decrypt(request: DecryptionRequest): Promise<string> {
  return encryptionManager.decrypt(request);
}