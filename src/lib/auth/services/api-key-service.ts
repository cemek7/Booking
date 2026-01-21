import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { webcrypto as crypto } from 'crypto';
import bcrypt from 'bcryptjs';
import { observability } from '../../observability/observability';

export const APIKeyCreateSchema = z.object({
  user_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  scopes: z.array(z.string()).default([]),
  rate_limit_per_hour: z.number().min(1).max(10000).default(1000),
  expires_in_days: z.number().min(1).max(365).optional(),
});

interface APIKeyRecord {
  id: string;
  key_id: string;
  key_hash: string;
  user_id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  scopes: string[];
  rate_limit_per_hour: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface CreateAPIKeyResult {
  keyId: string;
  apiKey: string;
  hashedKey: string;
}

interface ValidateAPIKeyResult {
  valid: boolean;
  key_details?: APIKeyRecord;
}

/**
 * Service for API key management
 */
export class APIKeyService {
  private supabase: SupabaseClient;

  private config = {
    key_length: 32,
    key_id_length: 8,
    hash_rounds: 12,
  };

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Create a new API key
   */
  async createAPIKey(data: z.infer<typeof APIKeyCreateSchema>): Promise<CreateAPIKeyResult> {
    const traceContext = observability.startTrace('api_key.create');

    try {
      const validatedData = APIKeyCreateSchema.parse(data);
      observability.setTraceTag(traceContext, 'user_id', validatedData.user_id);

      const keyId = this.generateKeyId();
      const apiKey = this.generateAPIKey();
      const hashedKey = await bcrypt.hash(apiKey, this.config.hash_rounds);

      const expiresAt = validatedData.expires_in_days
        ? new Date(Date.now() + validatedData.expires_in_days * 24 * 60 * 60 * 1000)
        : null;

      const { error } = await this.supabase.from('api_keys').insert({
        key_id: keyId,
        key_hash: hashedKey,
        user_id: validatedData.user_id,
        tenant_id: validatedData.tenant_id,
        name: validatedData.name,
        description: validatedData.description,
        scopes: validatedData.scopes,
        rate_limit_per_hour: validatedData.rate_limit_per_hour,
        expires_at: expiresAt?.toISOString(),
      });

      if (error) throw error;

      observability.recordBusinessMetric('api_key_created_total', 1);
      observability.finishTrace(traceContext, 'success');

      return {
        keyId,
        apiKey: `${keyId}.${apiKey}`,
        hashedKey,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to create API key', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Validate an API key
   */
  async validateAPIKey(apiKey: string): Promise<ValidateAPIKeyResult> {
    const traceContext = observability.startTrace('api_key.validate');

    try {
      const [keyId, secret] = apiKey.split('.');
      if (!keyId || !secret) {
        return { valid: false };
      }

      observability.setTraceTag(traceContext, 'key_id', keyId);

      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('key_id', keyId)
        .single();

      if (error || !data) {
        observability.finishTrace(traceContext, 'success');
        return { valid: false };
      }

      // Check expiration
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        observability.finishTrace(traceContext, 'success');
        return { valid: false };
      }

      // Validate hash
      const isValid = await bcrypt.compare(secret, data.key_hash);

      if (isValid) {
        // Update last used timestamp
        await this.supabase
          .from('api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('key_id', keyId);
      }

      observability.finishTrace(traceContext, 'success');
      return { valid: isValid, key_details: isValid ? data : undefined };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to validate API key', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Revoke an API key
   */
  async revokeAPIKey(keyId: string, userId: string): Promise<{ success: boolean }> {
    const traceContext = observability.startTrace('api_key.revoke');

    try {
      observability.setTraceTag(traceContext, 'key_id', keyId);
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { error } = await this.supabase
        .from('api_keys')
        .delete()
        .eq('key_id', keyId)
        .eq('user_id', userId);

      if (error) throw error;

      observability.recordBusinessMetric('api_key_revoked_total', 1);
      observability.finishTrace(traceContext, 'success');

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to revoke API key', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get API key details
   */
  async getAPIKey(keyId: string, userId: string): Promise<APIKeyRecord | null> {
    const traceContext = observability.startTrace('api_key.get');

    try {
      observability.setTraceTag(traceContext, 'key_id', keyId);

      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('key_id', keyId)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get API key', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Get all API keys for a user
   */
  async getUserAPIKeys(userId: string): Promise<APIKeyRecord[]> {
    const traceContext = observability.startTrace('api_key.get_user_keys');

    try {
      observability.setTraceTag(traceContext, 'user_id', userId);

      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      observability.finishTrace(traceContext, 'success');
      return data || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      observability.addTraceLog(traceContext, 'error', 'Failed to get user API keys', {
        error_message: errorMessage,
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  // Private helper methods

  private generateKeyId(): string {
    const bytes = new Uint8Array(this.config.key_id_length);
    crypto.getRandomValues(bytes);
    return 'bk_' + Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private generateAPIKey(): string {
    const bytes = new Uint8Array(this.config.key_length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
