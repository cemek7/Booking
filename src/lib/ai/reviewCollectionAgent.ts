/**
 * AI Review Collection Agent
 * 
 * Conversational AI agent that collects customer reviews via WhatsApp
 * after service completion. Uses natural language to request feedback,
 * extract ratings, and gather detailed reviews.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createEvolutionClient } from '@/lib/whatsapp/evolutionClient';

interface ReviewRequest {
  reservationId: string;
  tenantId: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  serviceName: string;
  completedAt: string;
}

interface ReviewResponse {
  overallRating?: number;
  staffRating?: number;
  serviceRating?: number;
  facilityRating?: number;
  reviewText?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

interface ReviewConversationState {
  reservationId: string;
  step: 'initial_request' | 'awaiting_rating' | 'awaiting_feedback' | 'completed';
  ratings: ReviewResponse;
  attempts: number;
}

export class ReviewCollectionAgent {
  private supabase = createServerSupabaseClient();
  private evolutionClient = createEvolutionClient();

  /**
   * Initiate review collection for a completed booking
   */
  async initiateReviewRequest(request: ReviewRequest): Promise<boolean> {
    try {
      // Check if review already exists
      const { data: existingReview } = await this.supabase
        .from('reviews')
        .select('id')
        .eq('reservation_id', request.reservationId)
        .single();

      if (existingReview) {
        console.log(`Review already exists for reservation ${request.reservationId}`);
        return false;
      }

      // Create conversation state
      const state: ReviewConversationState = {
        reservationId: request.reservationId,
        step: 'initial_request',
        ratings: {},
        attempts: 0,
      };

      // Store state in session
      await this.supabase
        .from('whatsapp_sessions')
        .upsert({
          phone_number: request.customerPhone,
          tenant_id: request.tenantId,
          session_type: 'review_collection',
          state: state,
          metadata: {
            reservation_id: request.reservationId,
            staff_name: request.staffName,
            service_name: request.serviceName,
          },
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        });

      // Send initial review request message
      const message = this.generateInitialMessage(request);
      await this.sendMessage(request.customerPhone, message);

      // Log the review request
      await this.supabase
        .from('analytics_events')
        .insert({
          tenant_id: request.tenantId,
          event_type: 'review_requested',
          customer_id: request.customerId,
          reservation_id: request.reservationId,
          metadata: {
            staff_id: request.staffId,
            service_id: request.serviceId,
            request_channel: 'whatsapp',
          },
        });

      return true;
    } catch (error) {
      console.error('Error initiating review request:', error);
      return false;
    }
  }

  /**
   * Process customer response in review conversation
   */
  async processReviewResponse(
    tenantId: string,
    customerPhone: string,
    message: string
  ): Promise<{ reply: string; completed: boolean }> {
    try {
      // Get current conversation state
      const { data: session } = await this.supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('phone_number', customerPhone)
        .eq('session_type', 'review_collection')
        .eq('tenant_id', tenantId)
        .single();

      if (!session) {
        return {
          reply: '',
          completed: false,
        };
      }

      const state = session.state as ReviewConversationState;
      const metadata = session.metadata as any;

      // Process based on current step
      switch (state.step) {
        case 'initial_request':
        case 'awaiting_rating':
          return await this.processRatingResponse(state, metadata, message, customerPhone);

        case 'awaiting_feedback':
          return await this.processFeedbackResponse(state, metadata, message, customerPhone);

        default:
          return {
            reply: 'Thank you for your feedback! We appreciate your time.',
            completed: true,
          };
      }
    } catch (error) {
      console.error('Error processing review response:', error);
      return {
        reply: 'Sorry, there was an error processing your response. Please try again.',
        completed: false,
      };
    }
  }

  /**
   * Extract rating from customer message
   */
  private extractRating(message: string): number | null {
    const cleanMessage = message.toLowerCase().trim();

    // Check for numeric rating (1-5)
    const numericMatch = cleanMessage.match(/\b([1-5])\b/);
    if (numericMatch) {
      return parseInt(numericMatch[1]);
    }

    // Check for star emojis
    const starCount = (message.match(/⭐/g) || []).length;
    if (starCount >= 1 && starCount <= 5) {
      return starCount;
    }

    // Check for word-based ratings
    const ratingWords: Record<string, number> = {
      'excellent': 5,
      'great': 5,
      'amazing': 5,
      'perfect': 5,
      'good': 4,
      'nice': 4,
      'okay': 3,
      'ok': 3,
      'average': 3,
      'fair': 3,
      'poor': 2,
      'bad': 2,
      'terrible': 1,
      'awful': 1,
    };

    for (const [word, rating] of Object.entries(ratingWords)) {
      if (cleanMessage.includes(word)) {
        return rating;
      }
    }

    return null;
  }

  /**
   * Analyze sentiment of feedback text
   */
  private analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
    const cleanText = text.toLowerCase();

    const positiveWords = ['great', 'excellent', 'amazing', 'love', 'wonderful', 'fantastic', 'perfect', 'best', 'enjoyed', 'happy', 'satisfied'];
    const negativeWords = ['bad', 'terrible', 'awful', 'worst', 'hate', 'disappointed', 'poor', 'horrible', 'never', 'rude'];

    let positiveCount = 0;
    let negativeCount = 0;

    for (const word of positiveWords) {
      if (cleanText.includes(word)) positiveCount++;
    }

    for (const word of negativeWords) {
      if (cleanText.includes(word)) negativeCount++;
    }

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Process rating response
   */
  private async processRatingResponse(
    state: ReviewConversationState,
    metadata: any,
    message: string,
    customerPhone: string
  ): Promise<{ reply: string; completed: boolean }> {
    const rating = this.extractRating(message);

    if (rating === null) {
      // Could not extract rating, ask again
      state.attempts++;
      
      if (state.attempts >= 2) {
        // Give up after 2 attempts
        return {
          reply: "I understand. Thank you anyway! If you'd like to leave feedback later, feel free to message us anytime.",
          completed: true,
        };
      }

      return {
        reply: `I didn't quite catch that. Could you rate your experience with ${metadata.staff_name} from 1 to 5? You can send a number (1-5) or use star emojis ⭐`,
        completed: false,
      };
    }

    // Store the rating
    state.ratings.overallRating = rating;
    state.ratings.staffRating = rating; // Same rating for now
    state.ratings.serviceRating = rating;
    state.step = 'awaiting_feedback';
    state.attempts = 0;

    // Update state
    await this.updateSessionState(customerPhone, state);

    // Ask for detailed feedback
    const followUpMessage = rating >= 4
      ? `Thank you for the ${rating} star rating! 🌟 We're glad you had a great experience. Would you like to share any specific feedback about your ${metadata.service_name} service?`
      : rating === 3
      ? `Thank you for the ${rating} star rating. We'd love to know how we can improve. What could we have done better?`
      : `Thank you for your ${rating} star rating. We appreciate your honest feedback. Please share what went wrong so we can improve.`;

    return {
      reply: followUpMessage,
      completed: false,
    };
  }

  /**
   * Process feedback text response
   */
  private async processFeedbackResponse(
    state: ReviewConversationState,
    metadata: any,
    message: string,
    customerPhone: string
  ): Promise<{ reply: string; completed: boolean }> {
    // Check if customer wants to skip
    const skipWords = ['no', 'skip', 'nothing', 'no thanks', 'that\'s all'];
    const wantsToSkip = skipWords.some(word => message.toLowerCase().includes(word));

    if (!wantsToSkip && message.length >= 10) {
      // Store the feedback text
      state.ratings.reviewText = message;
      state.ratings.sentiment = this.analyzeSentiment(message);
    }

    // Save the review to database
    await this.saveReview(state, metadata);

    state.step = 'completed';
    await this.updateSessionState(customerPhone, state);

    // Send thank you message
    const thankYouMessage = state.ratings.overallRating! >= 4
      ? `Thank you so much for your ${state.ratings.overallRating} star review! 🙏 We're thrilled you enjoyed your experience. Looking forward to seeing you again! 💫`
      : `Thank you for your feedback! We take all reviews seriously and will work on improving. We hope to serve you better next time. 🙏`;

    return {
      reply: thankYouMessage,
      completed: true,
    };
  }

  /**
   * Save review to database
   */
  private async saveReview(
    state: ReviewConversationState,
    metadata: any
  ): Promise<void> {
    try {
      // Get reservation details
      const { data: reservation } = await this.supabase
        .from('reservations')
        .select('tenant_id, customer_id, staff_id, service_id')
        .eq('id', state.reservationId)
        .single();

      if (!reservation) {
        console.error('Reservation not found for review:', state.reservationId);
        return;
      }

      // Insert review
      const { error } = await this.supabase
        .from('reviews')
        .insert({
          tenant_id: reservation.tenant_id,
          reservation_id: state.reservationId,
          customer_id: reservation.customer_id,
          staff_id: reservation.staff_id,
          service_id: reservation.service_id,
          overall_rating: state.ratings.overallRating,
          staff_rating: state.ratings.staffRating,
          service_rating: state.ratings.serviceRating,
          facility_rating: state.ratings.facilityRating,
          review_text: state.ratings.reviewText,
          status: 'published',
          is_verified: true, // Auto-verify WhatsApp reviews
        });

      if (error) {
        console.error('Error saving review:', error);
        return;
      }

      // Log analytics event
      await this.supabase
        .from('analytics_events')
        .insert({
          tenant_id: reservation.tenant_id,
          event_type: 'review_submitted',
          customer_id: reservation.customer_id,
          reservation_id: state.reservationId,
          metadata: {
            rating: state.ratings.overallRating,
            sentiment: state.ratings.sentiment,
            collection_method: 'whatsapp_ai',
            has_text: !!state.ratings.reviewText,
          },
        });

      // Trigger staff rating aggregation
      await this.supabase.rpc('aggregate_staff_ratings', {
        p_tenant_id: reservation.tenant_id,
        p_staff_id: reservation.staff_id,
        p_period_start: new Date(new Date().setDate(1)).toISOString().split('T')[0], // First day of month
        p_period_end: new Date().toISOString().split('T')[0], // Today
        p_period_type: 'month',
      });

      console.log('Review saved successfully for reservation:', state.reservationId);
    } catch (error) {
      console.error('Error in saveReview:', error);
    }
  }

  /**
   * Update session state
   */
  private async updateSessionState(
    customerPhone: string,
    state: ReviewConversationState
  ): Promise<void> {
    await this.supabase
      .from('whatsapp_sessions')
      .update({ state: state })
      .eq('phone_number', customerPhone)
      .eq('session_type', 'review_collection');
  }

  /**
   * Generate initial review request message
   */
  private generateInitialMessage(request: ReviewRequest): string {
    const templates = [
      `Hi ${request.customerName}! 👋 Thank you for choosing us for your ${request.serviceName}. We hope you enjoyed your experience with ${request.staffName}! ✨\n\nWe'd love to hear your feedback. How would you rate your visit? (1-5 stars)`,
      
      `Hello ${request.customerName}! 😊 Your ${request.serviceName} appointment with ${request.staffName} is complete. We'd really appreciate your feedback!\n\nOn a scale of 1-5, how was your experience? ⭐`,
      
      `Hey ${request.customerName}! Thanks for visiting us! 🙏 How did your ${request.serviceName} session with ${request.staffName} go?\n\nPlease rate your experience from 1 to 5 stars!`,
    ];

    // Randomly select a template for A/B testing
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Send WhatsApp message
   */
  private async sendMessage(phone: string, message: string): Promise<void> {
    try {
      await this.evolutionClient.sendMessage(phone, message);
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }

  /**
   * Schedule review request for a completed booking
   * Called by automation workflow
   */
  static async scheduleReviewRequest(
    reservationId: string,
    delayHours: number = 2
  ): Promise<void> {
    const supabase = createServerSupabaseClient();

    try {
      // Get reservation details
      const { data: reservation } = await supabase
        .from('reservations')
        .select(`
          id,
          tenant_id,
          customer_id,
          staff_id,
          service_id,
          start_at,
          metadata,
          customers(customer_name, customer_phone),
          users!reservations_staff_id_fkey(full_name),
          services(name)
        `)
        .eq('id', reservationId)
        .eq('status', 'completed')
        .single();

      if (!reservation || !reservation.customers || !reservation.users) {
        console.log('Reservation not found or incomplete data:', reservationId);
        return;
      }

      const scheduledAt = new Date(Date.now() + delayHours * 60 * 60 * 1000);

      // Queue the review request
      await supabase
        .from('whatsapp_message_queue')
        .insert({
          tenant_id: reservation.tenant_id,
          message_id: `review_req_${reservationId}_${Date.now()}`,
          from_number: 'system', // Will be replaced with tenant's WhatsApp number
          to_number: reservation.customers.customer_phone,
          content: JSON.stringify({
            type: 'review_request',
            reservation_id: reservationId,
            customer_id: reservation.customer_id,
            customer_name: reservation.customers.customer_name,
            staff_id: reservation.staff_id,
            staff_name: reservation.users.full_name,
            service_id: reservation.service_id,
            service_name: reservation.services?.name,
            completed_at: reservation.start_at,
          }),
          priority: 'normal',
          status: 'pending',
          scheduled_at: scheduledAt.toISOString(),
          retry_count: 0,
          max_retries: 2,
          metadata: {
            automation: 'review_collection',
            reservation_id: reservationId,
          },
        });

      console.log(`Review request scheduled for ${scheduledAt.toISOString()}`);
    } catch (error) {
      console.error('Error scheduling review request:', error);
    }
  }
}

export const reviewCollectionAgent = new ReviewCollectionAgent();
