import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface MessageDeduplication {
  id: string;
  tenant_id: string;
  message_hash: string;
  original_message_id: string;
  phone_number: string;
  content_hash: string;
  sequence_number: number;
  duplicate_count: number;
  first_seen: string;
  last_seen: string;
  metadata: Record<string, any>;
}

export interface MessageSequence {
  id: string;
  tenant_id: string;
  phone_number: string;
  conversation_id: string;
  sequence_number: number;
  expected_next: number;
  out_of_order_messages: string[];
  last_message_id: string;
  last_message_time: string;
  gap_detected: boolean;
  created_at: string;
  updated_at: string;
}

class WhatsAppMessageDeduplicator {
  private supabase = createServerSupabaseClient();
  private readonly DEDUP_WINDOW_HOURS = 24; // Check for duplicates within 24 hours
  private readonly SEQUENCE_TIMEOUT_MINUTES = 5; // Wait 5 minutes for out-of-order messages
  private readonly MAX_DUPLICATE_COUNT = 5; // Alert after 5 duplicates
  private messageCache = new Map<string, Set<string>>(); // tenant_id -> Set of message hashes

  /**
   * Check if a message is a duplicate and handle deduplication
   */
  async processDuplicateCheck(
    tenantId: string,
    messageId: string,
    phoneNumber: string,
    content: string,
    timestamp: number
  ): Promise<{
    isDuplicate: boolean;
    originalMessageId?: string;
    duplicateCount?: number;
    shouldProcess: boolean;
  }> {
    try {
      console.log(`🔍 Checking for duplicates: ${messageId} from ${phoneNumber}`);

      // Generate content hash
      const contentHash = this.generateContentHash(content, phoneNumber, timestamp);
      const messageHash = this.generateMessageHash(messageId, phoneNumber, contentHash);

      // Check cache first for quick lookup
      const cacheKey = `${tenantId}:${phoneNumber}`;
      if (this.messageCache.has(cacheKey) && this.messageCache.get(cacheKey)!.has(contentHash)) {
        console.log(`🚫 Duplicate detected in cache: ${messageId}`);
        return { isDuplicate: true, shouldProcess: false };
      }

      // Check database for duplicates within the deduplication window
      const windowStart = new Date(Date.now() - this.DEDUP_WINDOW_HOURS * 60 * 60 * 1000);
      
      const { data: existingDup, error: dupError } = await this.supabase
        .from('whatsapp_message_deduplication')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .eq('content_hash', contentHash)
        .gte('first_seen', windowStart.toISOString())
        .single();

      if (dupError && dupError.code !== 'PGRST116') {
        console.error('Error checking duplicates:', dupError);
        return { isDuplicate: false, shouldProcess: true };
      }

      if (existingDup) {
        // Update duplicate count and last seen
        const duplicateCount = existingDup.duplicate_count + 1;
        
        await this.supabase
          .from('whatsapp_message_deduplication')
          .update({
            duplicate_count: duplicateCount,
            last_seen: new Date().toISOString(),
            metadata: {
              ...existingDup.metadata,
              latest_duplicate_id: messageId,
              duplicate_timestamps: [
                ...(existingDup.metadata?.duplicate_timestamps || []),
                timestamp
              ]
            }
          })
          .eq('id', existingDup.id);

        // Add to cache
        if (!this.messageCache.has(cacheKey)) {
          this.messageCache.set(cacheKey, new Set());
        }
        this.messageCache.get(cacheKey)!.add(contentHash);

        // Alert if too many duplicates
        if (duplicateCount >= this.MAX_DUPLICATE_COUNT) {
          await this.alertExcessiveDuplicates(tenantId, phoneNumber, duplicateCount);
        }

        console.log(`🚫 Duplicate message detected: ${messageId} (count: ${duplicateCount})`);
        return {
          isDuplicate: true,
          originalMessageId: existingDup.original_message_id,
          duplicateCount,
          shouldProcess: false
        };
      }

      // Not a duplicate - record it
      await this.recordMessage(tenantId, messageId, phoneNumber, contentHash, messageHash);
      
      // Add to cache
      if (!this.messageCache.has(cacheKey)) {
        this.messageCache.set(cacheKey, new Set());
      }
      this.messageCache.get(cacheKey)!.add(contentHash);

      return { isDuplicate: false, shouldProcess: true };

    } catch (error) {
      console.error('Error in duplicate check:', error);
      // Fail safe - allow processing if check fails
      return { isDuplicate: false, shouldProcess: true };
    }
  }

  /**
   * Validate and update message sequence
   */
  async validateMessageSequence(
    tenantId: string,
    messageId: string,
    phoneNumber: string,
    timestamp: number,
    conversationId?: string
  ): Promise<{
    isInOrder: boolean;
    sequenceNumber: number;
    gapDetected: boolean;
    missingMessages: number[];
  }> {
    try {
      console.log(`📋 Validating sequence for message: ${messageId}`);

      // Get or create sequence tracking
      let sequence = await this.getMessageSequence(tenantId, phoneNumber, conversationId);
      
      if (!sequence) {
        sequence = await this.createMessageSequence(tenantId, phoneNumber, conversationId, messageId, timestamp);
        return {
          isInOrder: true,
          sequenceNumber: 1,
          gapDetected: false,
          missingMessages: []
        };
      }

      // Calculate expected sequence number based on timestamp and existing messages
      const expectedSequence = sequence.expected_next;
      const actualSequence = await this.calculateSequenceNumber(tenantId, phoneNumber, timestamp);

      const isInOrder = actualSequence === expectedSequence;
      const gapDetected = actualSequence > expectedSequence + 1;

      // Update sequence tracking
      await this.updateMessageSequence(
        sequence.id,
        messageId,
        actualSequence,
        timestamp,
        isInOrder,
        gapDetected
      );

      // If gap detected, check for missing messages
      let missingMessages: number[] = [];
      if (gapDetected) {
        missingMessages = this.calculateMissingSequences(expectedSequence, actualSequence);
        console.warn(`⚠️ Message sequence gap detected. Missing: ${missingMessages.join(', ')}`);
        
        // Schedule check for out-of-order messages
        setTimeout(() => {
          this.checkForOutOfOrderMessages(tenantId, phoneNumber, missingMessages);
        }, this.SEQUENCE_TIMEOUT_MINUTES * 60 * 1000);
      }

      return {
        isInOrder,
        sequenceNumber: actualSequence,
        gapDetected,
        missingMessages
      };

    } catch (error) {
      console.error('Error validating message sequence:', error);
      return {
        isInOrder: true,
        sequenceNumber: 1,
        gapDetected: false,
        missingMessages: []
      };
    }
  }

  /**
   * Generate content hash for duplicate detection
   */
  private generateContentHash(content: string, phoneNumber: string, timestamp: number): string {
    // Normalize content for hashing
    const normalizedContent = content.trim().toLowerCase().replace(/\s+/g, ' ');
    
    // Include phone number and timestamp (rounded to minute) to avoid false positives
    const timestampMinute = Math.floor(timestamp / 60000) * 60000;
    const hashInput = `${normalizedContent}:${phoneNumber}:${timestampMinute}`;
    
    // Simple hash function (in production, use crypto.createHash)
    return Buffer.from(hashInput).toString('base64');
  }

  /**
   * Generate unique message hash
   */
  private generateMessageHash(messageId: string, phoneNumber: string, contentHash: string): string {
    return Buffer.from(`${messageId}:${phoneNumber}:${contentHash}`).toString('base64');
  }

  /**
   * Record a new message for deduplication tracking
   */
  private async recordMessage(
    tenantId: string,
    messageId: string,
    phoneNumber: string,
    contentHash: string,
    messageHash: string
  ): Promise<void> {
    try {
      const record: Omit<MessageDeduplication, 'id'> = {
        tenant_id: tenantId,
        message_hash: messageHash,
        original_message_id: messageId,
        phone_number: phoneNumber,
        content_hash: contentHash,
        sequence_number: await this.getNextSequenceNumber(tenantId, phoneNumber),
        duplicate_count: 1,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        metadata: {
          original_timestamp: Date.now()
        }
      };

      await this.supabase
        .from('whatsapp_message_deduplication')
        .insert(record);

    } catch (error) {
      console.error('Error recording message for deduplication:', error);
    }
  }

  /**
   * Get message sequence tracking
   */
  private async getMessageSequence(
    tenantId: string,
    phoneNumber: string,
    conversationId?: string
  ): Promise<MessageSequence | null> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_message_sequences')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .eq('conversation_id', conversationId || '')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error getting message sequence:', error);
        return null;
      }

      return data as MessageSequence;
    } catch (error) {
      console.error('Error getting message sequence:', error);
      return null;
    }
  }

  /**
   * Create new message sequence tracking
   */
  private async createMessageSequence(
    tenantId: string,
    phoneNumber: string,
    conversationId: string | undefined,
    messageId: string,
    timestamp: number
  ): Promise<MessageSequence> {
    try {
      const sequence: Omit<MessageSequence, 'id'> = {
        tenant_id: tenantId,
        phone_number: phoneNumber,
        conversation_id: conversationId || '',
        sequence_number: 1,
        expected_next: 2,
        out_of_order_messages: [],
        last_message_id: messageId,
        last_message_time: new Date(timestamp).toISOString(),
        gap_detected: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('whatsapp_message_sequences')
        .insert(sequence)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data as MessageSequence;
    } catch (error) {
      console.error('Error creating message sequence:', error);
      throw error;
    }
  }

  /**
   * Update message sequence tracking
   */
  private async updateMessageSequence(
    sequenceId: string,
    messageId: string,
    sequenceNumber: number,
    timestamp: number,
    isInOrder: boolean,
    gapDetected: boolean
  ): Promise<void> {
    try {
      const updates = {
        sequence_number: sequenceNumber,
        expected_next: sequenceNumber + 1,
        last_message_id: messageId,
        last_message_time: new Date(timestamp).toISOString(),
        gap_detected: gapDetected,
        updated_at: new Date().toISOString()
      };

      // If message is out of order, add to tracking
      if (!isInOrder) {
        const { data: existing } = await this.supabase
          .from('whatsapp_message_sequences')
          .select('out_of_order_messages')
          .eq('id', sequenceId)
          .single();

        const outOfOrder = existing?.out_of_order_messages || [];
        outOfOrder.push(messageId);
        
        updates.out_of_order_messages = outOfOrder;
      }

      await this.supabase
        .from('whatsapp_message_sequences')
        .update(updates)
        .eq('id', sequenceId);

    } catch (error) {
      console.error('Error updating message sequence:', error);
    }
  }

  /**
   * Calculate sequence number based on timestamp
   */
  private async calculateSequenceNumber(
    tenantId: string,
    phoneNumber: string,
    timestamp: number
  ): Promise<number> {
    try {
      // Count messages from this phone number that occurred before this timestamp
      const { count, error } = await this.supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .lt('timestamp', timestamp);

      if (error) {
        console.error('Error calculating sequence number:', error);
        return 1;
      }

      return (count || 0) + 1;
    } catch (error) {
      console.error('Error calculating sequence number:', error);
      return 1;
    }
  }

  /**
   * Get next sequence number for deduplication tracking
   */
  private async getNextSequenceNumber(tenantId: string, phoneNumber: string): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('whatsapp_message_deduplication')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber);

      if (error) {
        console.error('Error getting next sequence number:', error);
        return 1;
      }

      return (count || 0) + 1;
    } catch (error) {
      console.error('Error getting next sequence number:', error);
      return 1;
    }
  }

  /**
   * Calculate missing sequence numbers
   */
  private calculateMissingSequences(expectedStart: number, actualCurrent: number): number[] {
    const missing: number[] = [];
    for (let i = expectedStart; i < actualCurrent; i++) {
      missing.push(i);
    }
    return missing;
  }

  /**
   * Check for out-of-order messages that might fill gaps
   */
  private async checkForOutOfOrderMessages(
    tenantId: string,
    phoneNumber: string,
    missingSequences: number[]
  ): Promise<void> {
    try {
      console.log(`🔍 Checking for out-of-order messages: ${missingSequences.join(', ')}`);

      // Query for messages that might have arrived out of order
      const { data: messages, error } = await this.supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .gte('created_at', new Date(Date.now() - this.SEQUENCE_TIMEOUT_MINUTES * 60 * 1000).toISOString())
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error checking for out-of-order messages:', error);
        return;
      }

      // Process any messages that might fill the gaps
      let gapsResolved = 0;
      for (const message of messages || []) {
        const sequenceNum = await this.calculateSequenceNumber(
          tenantId,
          phoneNumber,
          message.timestamp
        );

        if (missingSequences.includes(sequenceNum)) {
          console.log(`✅ Found out-of-order message filling sequence ${sequenceNum}`);
          gapsResolved++;
        }
      }

      if (gapsResolved > 0) {
        console.log(`✅ Resolved ${gapsResolved} sequence gaps`);
        
        // Update sequence tracking to reflect resolved gaps
        await this.recalculateSequence(tenantId, phoneNumber);
      } else {
        console.warn(`⚠️ ${missingSequences.length} sequence gaps remain unresolved`);
        await this.alertSequenceGap(tenantId, phoneNumber, missingSequences);
      }

    } catch (error) {
      console.error('Error checking for out-of-order messages:', error);
    }
  }

  /**
   * Recalculate sequence after resolving gaps
   */
  private async recalculateSequence(tenantId: string, phoneNumber: string): Promise<void> {
    try {
      // Get all messages for this phone number in chronological order
      const { data: messages, error } = await this.supabase
        .from('whatsapp_messages')
        .select('id, timestamp')
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error recalculating sequence:', error);
        return;
      }

      // Update sequence tracking
      if (messages && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        
        await this.supabase
          .from('whatsapp_message_sequences')
          .update({
            sequence_number: messages.length,
            expected_next: messages.length + 1,
            last_message_id: lastMessage.id,
            last_message_time: new Date(lastMessage.timestamp).toISOString(),
            gap_detected: false,
            out_of_order_messages: [],
            updated_at: new Date().toISOString()
          })
          .eq('tenant_id', tenantId)
          .eq('phone_number', phoneNumber);
      }

    } catch (error) {
      console.error('Error recalculating sequence:', error);
    }
  }

  /**
   * Alert about excessive duplicates
   */
  private async alertExcessiveDuplicates(
    tenantId: string,
    phoneNumber: string,
    duplicateCount: number
  ): Promise<void> {
    try {
      console.warn(`🚨 Excessive duplicates detected: ${duplicateCount} from ${phoneNumber}`);

      // Log alert
      await this.supabase
        .from('whatsapp_connection_logs')
        .insert({
          tenant_id: tenantId,
          instance_name: 'deduplicator',
          level: 'warning',
          message: `Excessive duplicate messages detected from ${phoneNumber}`,
          metadata: {
            phone_number: phoneNumber,
            duplicate_count: duplicateCount,
            alert_type: 'excessive_duplicates'
          },
          created_at: new Date().toISOString()
        });

      // TODO: Send notification to tenant admins

    } catch (error) {
      console.error('Error alerting excessive duplicates:', error);
    }
  }

  /**
   * Alert about sequence gaps
   */
  private async alertSequenceGap(
    tenantId: string,
    phoneNumber: string,
    missingSequences: number[]
  ): Promise<void> {
    try {
      console.warn(`🚨 Message sequence gap detected: missing ${missingSequences.join(', ')} from ${phoneNumber}`);

      // Log alert
      await this.supabase
        .from('whatsapp_connection_logs')
        .insert({
          tenant_id: tenantId,
          instance_name: 'deduplicator',
          level: 'warning',
          message: `Message sequence gap detected from ${phoneNumber}`,
          metadata: {
            phone_number: phoneNumber,
            missing_sequences: missingSequences,
            alert_type: 'sequence_gap'
          },
          created_at: new Date().toISOString()
        });

    } catch (error) {
      console.error('Error alerting sequence gap:', error);
    }
  }

  /**
   * Clean up old deduplication records
   */
  async cleanup(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - this.DEDUP_WINDOW_HOURS * 60 * 60 * 1000);
      
      const { error } = await this.supabase
        .from('whatsapp_message_deduplication')
        .delete()
        .lt('first_seen', cutoff.toISOString());

      if (error) {
        console.error('Error cleaning up deduplication records:', error);
      } else {
        console.log('✅ Cleaned up old deduplication records');
      }

      // Clear cache
      this.messageCache.clear();

    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Get deduplication statistics
   */
  async getDeduplicationStats(tenantId: string): Promise<{
    totalMessages: number;
    duplicateMessages: number;
    duplicateRate: number;
    sequenceGaps: number;
    outOfOrderMessages: number;
  }> {
    try {
      // Get total messages
      const { count: totalMessages } = await this.supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .gte('created_at', new Date(Date.now() - this.DEDUP_WINDOW_HOURS * 60 * 60 * 1000).toISOString());

      // Get duplicate count
      const { data: duplicates } = await this.supabase
        .from('whatsapp_message_deduplication')
        .select('duplicate_count')
        .eq('tenant_id', tenantId)
        .gte('first_seen', new Date(Date.now() - this.DEDUP_WINDOW_HOURS * 60 * 60 * 1000).toISOString());

      const duplicateMessages = duplicates?.reduce((sum, dup) => sum + (dup.duplicate_count - 1), 0) || 0;

      // Get sequence gaps
      const { count: sequenceGaps } = await this.supabase
        .from('whatsapp_message_sequences')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('gap_detected', true);

      // Get out-of-order messages
      const { data: sequences } = await this.supabase
        .from('whatsapp_message_sequences')
        .select('out_of_order_messages')
        .eq('tenant_id', tenantId);

      const outOfOrderMessages = sequences?.reduce((sum, seq) => 
        sum + (seq.out_of_order_messages?.length || 0), 0) || 0;

      return {
        totalMessages: totalMessages || 0,
        duplicateMessages,
        duplicateRate: totalMessages ? (duplicateMessages / totalMessages) * 100 : 0,
        sequenceGaps: sequenceGaps || 0,
        outOfOrderMessages
      };

    } catch (error) {
      console.error('Error getting deduplication stats:', error);
      return {
        totalMessages: 0,
        duplicateMessages: 0,
        duplicateRate: 0,
        sequenceGaps: 0,
        outOfOrderMessages: 0
      };
    }
  }
}

// Export singleton instance
export const whatsappMessageDeduplicator = new WhatsAppMessageDeduplicator();

// Start cleanup interval (run every hour)
setInterval(() => {
  whatsappMessageDeduplicator.cleanup().catch(console.error);
}, 60 * 60 * 1000);