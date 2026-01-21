import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Dialog Manager Extensions for WhatsApp Integration
 * Extends dialogManager.ts with phone-based session lookup
 */

interface DialogSession {
  id: string;
  tenant_id: string;
  current_step: string;
  booking_context: Record<string, any>;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

class DialogManagerWhatsAppExtension {
  private supabase = createServerSupabaseClient();

  /**
   * Get dialog session ID from phone number
   */
  async getSessionIdByPhone(tenantId: string, phoneNumber: string): Promise<string | null> {
    try {
      const { data: sessions, error } = await this.supabase
        .from('dialog_sessions')
        .select('id')
        .eq('tenant_id', tenantId)
        .contains('metadata', { phone: phoneNumber })
        .maybeSingle();

      if (error || !sessions) {
        return null;
      }

      return sessions.id;
    } catch (error) {
      console.error('Error getting session by phone:', error);
      return null;
    }
  }

  /**
   * Get or create customer from phone number
   */
  async getOrCreateCustomer(
    tenantId: string,
    phoneNumber: string,
    name?: string
  ): Promise<{ id: string; phone: string; name?: string }> {
    try {
      // Try to find existing customer
      const { data: existing, error: findErr } = await this.supabase
        .from('customers')
        .select('id, phone, name')
        .eq('tenant_id', tenantId)
        .eq('phone', phoneNumber)
        .maybeSingle();

      if (existing) {
        return { id: existing.id, phone: existing.phone, name: existing.name };
      }

      // Create new customer
      const { data: newCustomer, error: createErr } = await this.supabase
        .from('customers')
        .insert({
          tenant_id: tenantId,
          phone: phoneNumber,
          name: name || `Customer_${phoneNumber.slice(-4)}`,
          source: 'whatsapp',
          metadata: { whatsapp_session: true },
        })
        .select('id, phone, name')
        .single();

      if (createErr || !newCustomer) {
        throw new Error('Failed to create customer');
      }

      return newCustomer;
    } catch (error) {
      console.error('Error managing customer:', error);
      throw error;
    }
  }

  /**
   * Store booking context in dialog session
   */
  async updateBookingContext(
    sessionId: string,
    context: Record<string, any>
  ): Promise<void> {
    try {
      await this.supabase
        .from('dialog_sessions')
        .update({
          booking_context: context,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    } catch (error) {
      console.error('Error updating booking context:', error);
      throw error;
    }
  }

  /**
   * Get full dialog state for WhatsApp conversation
   */
  async getDialogState(sessionId: string): Promise<DialogSession | null> {
    try {
      const { data: session, error } = await this.supabase
        .from('dialog_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !session) {
        return null;
      }

      return session as DialogSession;
    } catch (error) {
      console.error('Error getting dialog state:', error);
      return null;
    }
  }

  /**
   * Advance dialog to next step
   */
  async advanceStep(sessionId: string, nextStep: string): Promise<void> {
    try {
      await this.supabase
        .from('dialog_sessions')
        .update({
          current_step: nextStep,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    } catch (error) {
      console.error('Error advancing step:', error);
      throw error;
    }
  }

  /**
   * Close dialog session (booking completed or abandoned)
   */
  async closeSession(sessionId: string, reason: 'completed' | 'abandoned' | 'error'): Promise<void> {
    try {
      await this.supabase
        .from('dialog_sessions')
        .update({
          current_step: 'closed',
          metadata: {
            closed_at: new Date().toISOString(),
            reason,
          },
        })
        .eq('id', sessionId);
    } catch (error) {
      console.error('Error closing session:', error);
      throw error;
    }
  }
}

export const dialogManagerWhatsApp = new DialogManagerWhatsAppExtension();
