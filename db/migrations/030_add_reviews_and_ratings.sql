-- Migration: Add Reviews and Ratings Tables
-- Description: Create tables to store customer reviews, staff ratings, and service feedback
-- Author: Analytics Enhancement
-- Date: 2026-02-23

-- Reviews table for storing customer feedback on bookings
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  staff_id UUID,
  service_id UUID,
  
  -- Rating fields (1-5 scale)
  overall_rating DECIMAL(2,1) NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
  staff_rating DECIMAL(2,1) CHECK (staff_rating >= 1 AND staff_rating <= 5),
  service_rating DECIMAL(2,1) CHECK (service_rating >= 1 AND service_rating <= 5),
  facility_rating DECIMAL(2,1) CHECK (facility_rating >= 1 AND facility_rating <= 5),
  
  -- Review content
  review_title VARCHAR(200),
  review_text TEXT,
  
  -- Response from business
  response_text TEXT,
  response_by UUID,
  response_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('pending', 'published', 'hidden', 'flagged')),
  is_verified BOOLEAN DEFAULT false,
  helpful_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT unique_review_per_reservation UNIQUE (reservation_id)
);

-- Staff performance ratings table for aggregated staff metrics
CREATE TABLE IF NOT EXISTS staff_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  
  -- Aggregated ratings
  average_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  five_star_count INTEGER DEFAULT 0,
  four_star_count INTEGER DEFAULT 0,
  three_star_count INTEGER DEFAULT 0,
  two_star_count INTEGER DEFAULT 0,
  one_star_count INTEGER DEFAULT 0,
  
  -- Performance metrics
  total_bookings INTEGER DEFAULT 0,
  completed_bookings INTEGER DEFAULT 0,
  completion_rate DECIMAL(5,2) DEFAULT 0,
  
  -- Time period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type VARCHAR(20) DEFAULT 'month' CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT fk_tenant_staff_ratings FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT unique_staff_period UNIQUE (staff_id, period_start, period_end, period_type)
);

-- Service ratings table for aggregated service metrics
CREATE TABLE IF NOT EXISTS service_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL,
  
  -- Aggregated ratings
  average_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  
  -- Performance metrics
  total_bookings INTEGER DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  average_duration_minutes INTEGER DEFAULT 0,
  popularity_score DECIMAL(5,2) DEFAULT 0,
  
  -- Time period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type VARCHAR(20) DEFAULT 'month' CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT fk_tenant_service_ratings FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT unique_service_period UNIQUE (service_id, period_start, period_end, period_type)
);

-- Analytics events table for tracking user journey and conversion funnels
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Event details
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
    'page_view', 'website_visit', 'chat_started', 'service_selected', 
    'booking_initiated', 'booking_completed', 'payment_made',
    'booking_cancelled', 'booking_rescheduled', 'review_submitted'
  )),
  event_category VARCHAR(50) CHECK (event_category IN ('navigation', 'engagement', 'conversion', 'retention')),
  
  -- User tracking
  user_id UUID,
  customer_id UUID,
  session_id VARCHAR(100),
  
  -- Context
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  service_id UUID,
  staff_id UUID,
  
  -- Event metadata
  metadata JSONB DEFAULT '{}',
  source VARCHAR(20) CHECK (source IN ('web', 'mobile', 'api', 'whatsapp', 'sms')),
  
  -- UTM tracking
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT fk_tenant_events FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reservation_id ON reviews(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer_id ON reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_staff_id ON reviews(staff_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(overall_rating);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE INDEX IF NOT EXISTS idx_staff_ratings_tenant_id ON staff_ratings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_ratings_staff_id ON staff_ratings(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_ratings_period ON staff_ratings(period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_service_ratings_tenant_id ON service_ratings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_ratings_service_id ON service_ratings(service_id);
CREATE INDEX IF NOT EXISTS idx_service_ratings_period ON service_ratings(period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_id ON analytics_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_customer ON analytics_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_reservation ON analytics_events(reservation_id);

-- Trigger to update updated_at on reviews
CREATE OR REPLACE FUNCTION update_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_reviews_updated_at();

-- Function to aggregate staff ratings
CREATE OR REPLACE FUNCTION aggregate_staff_ratings(
  p_tenant_id UUID,
  p_staff_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_period_type VARCHAR(20)
)
RETURNS VOID AS $$
DECLARE
  v_avg_rating DECIMAL(3,2);
  v_total_reviews INTEGER;
  v_star_counts INTEGER[];
  v_total_bookings INTEGER;
  v_completed_bookings INTEGER;
BEGIN
  -- Calculate review statistics
  SELECT 
    COALESCE(AVG(staff_rating), 0),
    COUNT(*),
    ARRAY[
      COUNT(*) FILTER (WHERE staff_rating >= 4.5),
      COUNT(*) FILTER (WHERE staff_rating >= 3.5 AND staff_rating < 4.5),
      COUNT(*) FILTER (WHERE staff_rating >= 2.5 AND staff_rating < 3.5),
      COUNT(*) FILTER (WHERE staff_rating >= 1.5 AND staff_rating < 2.5),
      COUNT(*) FILTER (WHERE staff_rating < 1.5)
    ]
  INTO v_avg_rating, v_total_reviews, v_star_counts
  FROM reviews
  WHERE tenant_id = p_tenant_id
    AND staff_id = p_staff_id
    AND created_at >= p_period_start
    AND created_at <= p_period_end
    AND staff_rating IS NOT NULL;

  -- Calculate booking statistics
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total_bookings, v_completed_bookings
  FROM reservations
  WHERE tenant_id = p_tenant_id
    AND staff_id = p_staff_id
    AND start_at >= p_period_start
    AND start_at <= p_period_end;

  -- Insert or update staff ratings
  INSERT INTO staff_ratings (
    tenant_id, staff_id, average_rating, total_reviews,
    five_star_count, four_star_count, three_star_count, two_star_count, one_star_count,
    total_bookings, completed_bookings, completion_rate,
    period_start, period_end, period_type
  )
  VALUES (
    p_tenant_id, p_staff_id, v_avg_rating, v_total_reviews,
    v_star_counts[1], v_star_counts[2], v_star_counts[3], v_star_counts[4], v_star_counts[5],
    v_total_bookings, v_completed_bookings,
    CASE WHEN v_total_bookings > 0 THEN (v_completed_bookings::DECIMAL / v_total_bookings * 100) ELSE 0 END,
    p_period_start, p_period_end, p_period_type
  )
  ON CONFLICT (staff_id, period_start, period_end, period_type)
  DO UPDATE SET
    average_rating = EXCLUDED.average_rating,
    total_reviews = EXCLUDED.total_reviews,
    five_star_count = EXCLUDED.five_star_count,
    four_star_count = EXCLUDED.four_star_count,
    three_star_count = EXCLUDED.three_star_count,
    two_star_count = EXCLUDED.two_star_count,
    one_star_count = EXCLUDED.one_star_count,
    total_bookings = EXCLUDED.total_bookings,
    completed_bookings = EXCLUDED.completed_bookings,
    completion_rate = EXCLUDED.completion_rate,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON reviews TO authenticated;
GRANT SELECT ON staff_ratings TO authenticated;
GRANT SELECT ON service_ratings TO authenticated;
GRANT INSERT ON analytics_events TO authenticated;
