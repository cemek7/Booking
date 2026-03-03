/**
 * Reviews API
 * 
 * Endpoint for submitting and managing customer reviews
 * Supports both manual submission and AI-collected reviews via WhatsApp
 */

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const ReviewSubmissionSchema = z.object({
  reservationId: z.string().uuid(),
  overallRating: z.number().min(1).max(5),
  staffRating: z.number().min(1).max(5).optional(),
  serviceRating: z.number().min(1).max(5).optional(),
  facilityRating: z.number().min(1).max(5).optional(),
  reviewTitle: z.string().max(200).optional(),
  reviewText: z.string().max(2000).optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const validation = ReviewSubmissionSchema.safeParse(body);

    if (!validation.success) {
      throw ApiErrorFactory.badRequest('Invalid review data', validation.error.errors);
    }

    const reviewData = validation.data;

    // Get reservation to verify ownership and get details
    const { data: reservation, error: reservationError } = await ctx.supabase
      .from('reservations')
      .select('id, tenant_id, customer_id, staff_id, service_id, status')
      .eq('id', reviewData.reservationId)
      .single();

    if (reservationError || !reservation) {
      throw ApiErrorFactory.notFound('Reservation not found');
    }

    // Verify the reservation belongs to the authenticated user's tenant
    if (reservation.tenant_id !== ctx.user.tenantId) {
      throw ApiErrorFactory.forbidden('Cannot review bookings from other tenants');
    }

    // Check if reservation is completed
    if (reservation.status !== 'completed') {
      throw ApiErrorFactory.badRequest('Can only review completed bookings');
    }

    // Check if review already exists
    const { data: existingReview } = await ctx.supabase
      .from('reviews')
      .select('id')
      .eq('reservation_id', reviewData.reservationId)
      .single();

    if (existingReview) {
      throw ApiErrorFactory.badRequest('Review already submitted for this booking');
    }

    // Create the review
    const { data: review, error: reviewError } = await ctx.supabase
      .from('reviews')
      .insert({
        tenant_id: reservation.tenant_id,
        reservation_id: reservation.id,
        customer_id: reservation.customer_id,
        staff_id: reservation.staff_id,
        service_id: reservation.service_id,
        overall_rating: reviewData.overallRating,
        staff_rating: reviewData.staffRating || reviewData.overallRating,
        service_rating: reviewData.serviceRating || reviewData.overallRating,
        facility_rating: reviewData.facilityRating,
        review_title: reviewData.reviewTitle,
        review_text: reviewData.reviewText,
        status: 'published',
        is_verified: false,
      })
      .select()
      .single();

    if (reviewError) {
      throw ApiErrorFactory.internal('Failed to save review');
    }

    // Log analytics event
    await ctx.supabase
      .from('analytics_events')
      .insert({
        tenant_id: reservation.tenant_id,
        event_type: 'review_submitted',
        customer_id: reservation.customer_id,
        reservation_id: reservation.id,
        metadata: {
          rating: reviewData.overallRating,
          collection_method: 'manual',
          has_text: !!reviewData.reviewText,
        },
      });

    return {
      success: true,
      review: {
        id: review.id,
        overall_rating: review.overall_rating,
        created_at: review.created_at,
      },
      message: 'Thank you for your review!',
    };
  },
  'POST',
  { auth: true }
);

export const GET = createHttpHandler(
  async (ctx) => {
    const { searchParams } = new URL(ctx.request.url);
    const reservationId = searchParams.get('reservationId');
    const staffId = searchParams.get('staffId');
    const limit = parseInt(searchParams.get('limit') || '10');

    let query = ctx.supabase
      .from('reviews')
      .select(`
        id,
        reservation_id,
        overall_rating,
        staff_rating,
        service_rating,
        facility_rating,
        review_title,
        review_text,
        status,
        created_at,
        customers(customer_name),
        users!reviews_staff_id_fkey(full_name),
        services(name)
      `)
      .eq('tenant_id', ctx.user.tenantId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (reservationId) {
      query = query.eq('reservation_id', reservationId);
    }

    if (staffId) {
      query = query.eq('staff_id', staffId);
    }

    const { data: reviews, error } = await query;

    if (error) {
      throw ApiErrorFactory.internal('Failed to fetch reviews');
    }

    return {
      success: true,
      reviews: reviews || [],
      count: reviews?.length || 0,
    };
  },
  'GET',
  { auth: true }
);
