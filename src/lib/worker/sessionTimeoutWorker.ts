/**
 * Session Timeout Worker
 * 
 * Cleans up inactive WhatsApp conversation sessions to prevent database bloat
 * and free up memory. Runs periodically to mark sessions as expired.
 * 
 * Timeout Policy:
 * - Sessions inactive for >30 minutes are marked as expired
 * - Expired sessions have their context cleared
 * - Conversation history is preserved for audit
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface SessionTimeoutConfig {
  /**
   * Inactivity timeout in minutes (default: 30)
   */
  timeoutMinutes?: number;
  
  /**
   * Whether to delete expired sessions or just mark them (default: false - mark only)
   */
  hardDelete?: boolean;
  
  /**
   * Maximum age of sessions to keep in days (default: 30)
   */
  maxAgeInDays?: number;
}

export class SessionTimeoutWorker {
  private config: Required<SessionTimeoutConfig>;
  private supabase;

  constructor(config: SessionTimeoutConfig = {}) {
    this.config = {
      timeoutMinutes: config.timeoutMinutes || 30,
      hardDelete: config.hardDelete ?? false,
      maxAgeInDays: config.maxAgeInDays || 30
    };
    this.supabase = createServerSupabaseClient();
  }

  /**
   * Run the session timeout cleanup
   * Returns count of sessions cleaned up
   */
  async run(): Promise<{ expired: number; deleted: number; errors: number }> {
    console.log('[SessionTimeout] Starting session cleanup...');
    
    const stats = {
      expired: 0,
      deleted: 0,
      errors: 0
    };

    try {
      // Step 1: Expire inactive sessions
      const expiredCount = await this.expireInactiveSessions();
      stats.expired = expiredCount;

      // Step 2: Delete old sessions if configured
      if (this.config.hardDelete) {
        const deletedCount = await this.deleteOldSessions();
        stats.deleted = deletedCount;
      }

      console.log('[SessionTimeout] Cleanup complete:', stats);
      return stats;
    } catch (error) {
      console.error('[SessionTimeout] Error during cleanup:', error);
      stats.errors = 1;
      return stats;
    }
  }

  /**
   * Mark inactive sessions as expired
   */
  private async expireInactiveSessions(): Promise<number> {
    const timeoutDate = new Date();
    timeoutDate.setMinutes(timeoutDate.getMinutes() - this.config.timeoutMinutes);

    try {
      // Find active sessions with last_activity > timeout threshold
      const { data: sessions, error: fetchError } = await this.supabase
        .from('whatsapp_conversations')
        .select('id, from_number, last_activity')
        .eq('status', 'active')
        .lt('last_activity', timeoutDate.toISOString());

      if (fetchError) {
        console.error('[SessionTimeout] Error fetching sessions:', fetchError);
        return 0;
      }

      if (!sessions || sessions.length === 0) {
        console.log('[SessionTimeout] No inactive sessions found');
        return 0;
      }

      console.log(`[SessionTimeout] Found ${sessions.length} inactive sessions`);

      // Update sessions to expired status and clear context
      const { error: updateError } = await this.supabase
        .from('whatsapp_conversations')
        .update({
          status: 'expired',
          context: {},  // Clear conversation context
          updated_at: new Date().toISOString()
        })
        .in('id', sessions.map(s => s.id));

      if (updateError) {
        console.error('[SessionTimeout] Error expiring sessions:', updateError);
        return 0;
      }

      console.log(`[SessionTimeout] Expired ${sessions.length} sessions`);
      return sessions.length;
    } catch (error) {
      console.error('[SessionTimeout] Exception in expireInactiveSessions:', error);
      return 0;
    }
  }

  /**
   * Delete very old sessions (hard delete if enabled)
   */
  private async deleteOldSessions(): Promise<number> {
    const deleteDate = new Date();
    deleteDate.setDate(deleteDate.getDate() - this.config.maxAgeInDays);

    try {
      // Find sessions older than maxAgeInDays
      const { data: sessions, error: fetchError } = await this.supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('status', 'expired')
        .lt('created_at', deleteDate.toISOString());

      if (fetchError || !sessions || sessions.length === 0) {
        return 0;
      }

      console.log(`[SessionTimeout] Deleting ${sessions.length} old sessions`);

      // Delete old sessions
      const { error: deleteError } = await this.supabase
        .from('whatsapp_conversations')
        .delete()
        .in('id', sessions.map(s => s.id));

      if (deleteError) {
        console.error('[SessionTimeout] Error deleting sessions:', deleteError);
        return 0;
      }

      return sessions.length;
    } catch (error) {
      console.error('[SessionTimeout] Exception in deleteOldSessions:', error);
      return 0;
    }
  }

  /**
   * Get stats about current sessions
   */
  async getSessionStats(): Promise<{
    active: number;
    expired: number;
    total: number;
  }> {
    const { data: stats, error } = await this.supabase
      .rpc('get_conversation_stats');

    if (error || !stats) {
      // Fallback to manual count
      const { count: activeCount } = await this.supabase
        .from('whatsapp_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      const { count: expiredCount } = await this.supabase
        .from('whatsapp_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'expired');

      return {
        active: activeCount || 0,
        expired: expiredCount || 0,
        total: (activeCount || 0) + (expiredCount || 0)
      };
    }

    return stats;
  }
}

/**
 * Run session timeout worker as a scheduled job
 * Can be called from cron, worker queue, or API endpoint
 */
export async function runSessionTimeoutWorker(config?: SessionTimeoutConfig): Promise<void> {
  const worker = new SessionTimeoutWorker(config);
  const result = await worker.run();
  
  console.log('[SessionTimeout] Worker completed:', {
    expired: result.expired,
    deleted: result.deleted,
    errors: result.errors,
    timestamp: new Date().toISOString()
  });
}

/**
 * Example usage in cron or worker:
 * 
 * // Every 15 minutes
 * setInterval(() => {
 *   runSessionTimeoutWorker({ timeoutMinutes: 30 });
 * }, 15 * 60 * 1000);
 */
