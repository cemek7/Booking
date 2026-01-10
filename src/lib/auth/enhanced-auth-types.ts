import { z } from 'zod';

// From enhanced-auth.ts
export interface AuthenticationEvent {
  user_id: string;
  event_type: 'login' | 'logout' | 'login_failed' | 'password_change' | 'mfa_setup' | 'mfa_verify' | 'mfa_failed' | 'session_timeout' | 'forced_logout' | 'password_reset' | 'security_settings_change';
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  success: boolean;
  failure_reason?: string;
  metadata?: Record<string, any>;
}

export interface UserSession {
  id: string;
  session_token: string;
  user_id: string;
  tenant_id?: string;
  ip_address?: string;
  user_agent?: string;
  device_fingerprint?: string;
  is_active: boolean;
  last_activity: Date;
  expires_at: Date;
  metadata?: Record<string, any>;
}

export interface MFAConfig {
  id: string;
  user_id: string;
  method: 'totp' | 'sms' | 'email' | 'backup_codes';
  is_primary: boolean;
  is_enabled: boolean;
  verified_at?: Date;
  last_used_at?: Date;
  failure_count: number;
  blocked_until?: Date;
}

export interface SecurityMetrics {
  login_count: number;
  failed_login_count: number;
  unique_ips: number;
  unique_devices: number;
  mfa_verifications: number;
  password_changes: number;
  lockout_events: number;
  last_login?: Date;
  suspicious_activity_score: 'low' | 'medium' | 'high';
}

export const LoginDataSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    mfa_code: z.string().optional(),
    remember_me: z.boolean().default(false),
    device_fingerprint: z.string().optional()
});
  
export type LoginData = z.infer<typeof LoginDataSchema>;
  
export interface ClientInfo {
    ip_address?: string;
    user_agent?: string;
}
  
export interface LoginResult {
    success: boolean;
    user?: any;
    session?: UserSession;
    mfa_required?: boolean;
    mfa_verified?: boolean;
    error?: string;
    error_details?: any;
    status?: number;
}
