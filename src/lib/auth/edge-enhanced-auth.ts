import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { observability } from '../observability/observability';
import { EventBusService } from '../eventbus/eventBus';
import { webcrypto } from 'crypto';

// PHASE 2B: Import canonical auth types from consolidated location
import type {
  AuthenticationEvent,
  UserSession,
  LoginData,
  ClientInfo,
  LoginResult
} from '@/types/auth';

// Basic schemas for edge validation
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

/**
 * Edge-compatible Enhanced Authentication Service
 *
 * This version is stripped down to work in the Next.js Edge Runtime.
 * It focuses on session validation and token verification.
 * Complex features like MFA setup, QR code generation, and heavy crypto
 * are handled by the Node.js version of this service.
 */
export class EnhancedAuthService {
  private supabase: any;
  private eventBus: EventBusService;
  private isInitialized = false;

  constructor() {
    // Initialization logic for edge can be lighter
  }

  async initialize(supabaseClient?: any) {
    if (this.isInitialized) return;
    this.supabase = supabaseClient || getSupabaseRouteHandlerClient();
    this.eventBus = new EventBusService();
    this.isInitialized = true;
    console.log('Edge EnhancedAuthService Initialized');
  }

  // A simplified login method for the edge if needed,
  // but typically full login is handled by the Node backend.
  async login(data: LoginData, clientInfo: ClientInfo): Promise<LoginResult> {
    const span = await observability.startTrace('edge-auth.login');
    try {
      const { email, password } = LoginSchema.parse(data);

      if (!this.supabase) {
        throw new Error('Supabase client is not initialized.');
      }

      const { data: authData, error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        await this.logAuthEvent('login_failed', { email, error: error.message }, clientInfo);
        return { success: false, error: error.message };
      }

      if (!authData.user) {
        return { success: false, error: 'Login failed: User not found.' };
      }

      await this.logAuthEvent('login_successful', { userId: authData.user.id }, clientInfo);
      return { success: true, user: authData.user, session: authData.session };

    } catch (error) {
      span?.recordException(error as Error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return { success: false, error: errorMessage };
    } finally {
      span?.end();
    }
  }

  async validateSession(token: string): Promise<UserSession | null> {
    const span = await observability.startTrace('edge-auth.validateSession');
    try {
      if (!this.supabase) {
        await this.initialize();
      }
      const { data: { user } } = await this.supabase.auth.getUser(token);
      if (user) {
        // In a real scenario, you might enrich the session from your DB
        return {
          userId: user.id,
          email: user.email,
          role: user.role || 'user', // Default role
          isAuthenticated: true,
        };
      }
      return null;
    } catch (error) {
      span?.recordException(error as Error);
      return null;
    } finally {
      span?.end();
    }
  }

  private async logAuthEvent(eventType: string, payload: any, clientInfo: ClientInfo) {
    // Simplified event logging for the edge
    console.log(`Auth Event [${eventType}]:`, { ...payload, ...clientInfo });
    // In a real edge scenario, you might send this to a logging service via fetch
  }
}

export const enhancedAuthService = new EnhancedAuthService();
