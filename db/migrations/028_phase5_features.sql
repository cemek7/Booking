-- Migration 028: Phase 5 Features - Analytics, Modules, and ML Infrastructure
-- This migration adds support for advanced analytics, vertical modules, and ML predictions

-- Tenant Modules Registry
CREATE TABLE IF NOT EXISTS tenant_modules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registry_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics Metrics Cache
CREATE TABLE IF NOT EXISTS analytics_metrics_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_type VARCHAR(100) NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  value DECIMAL(15,2) NOT NULL,
  metadata JSONB DEFAULT '{}',
  period_type VARCHAR(20) NOT NULL, -- 'day', 'week', 'month', 'quarter', 'year'
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

-- ML Models Registry
CREATE TABLE IF NOT EXISTS ml_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model_type VARCHAR(100) NOT NULL, -- 'scheduling', 'demand_forecasting', 'anomaly_detection', 'pricing_optimization'
  model_name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'training', -- 'training', 'ready', 'updating', 'error', 'deprecated'
  accuracy DECIMAL(5,4), -- Model accuracy score (0-1)
  parameters JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  training_data_hash VARCHAR(64), -- Hash of training data for change detection
  last_trained TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ML Predictions Storage
CREATE TABLE IF NOT EXISTS ml_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
  prediction_type VARCHAR(100) NOT NULL,
  input_data JSONB NOT NULL,
  prediction_data JSONB NOT NULL,
  confidence_score DECIMAL(5,4), -- 0-1
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

-- Anomaly Detection Log
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  anomaly_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  score DECIMAL(5,4) NOT NULL, -- Anomaly score 0-1
  description TEXT NOT NULL,
  data_points JSONB NOT NULL,
  suggested_actions JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'investigating', 'resolved', 'false_positive'
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  auto_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer Analytics Cache
CREATE TABLE IF NOT EXISTS customer_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  lifetime_value DECIMAL(10,2),
  predicted_ltv DECIMAL(10,2),
  churn_probability DECIMAL(5,4), -- 0-1
  next_booking_likelihood DECIMAL(5,4), -- 0-1
  next_booking_predicted_date DATE,
  loyalty_score INTEGER DEFAULT 0,
  personalization_profile JSONB DEFAULT '{}',
  last_calculated TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- Revenue Optimization Recommendations
CREATE TABLE IF NOT EXISTS revenue_optimizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  optimization_type VARCHAR(100) NOT NULL, -- 'pricing', 'upsell', 'cross_sell', 'capacity'
  target_id UUID NOT NULL, -- service_id, staff_id, etc.
  target_type VARCHAR(50) NOT NULL, -- 'service', 'staff', 'time_slot'
  current_value DECIMAL(10,2),
  optimized_value DECIMAL(10,2),
  expected_impact DECIMAL(5,2), -- Percentage change
  confidence DECIMAL(5,4), -- 0-1
  factors JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'applied', 'rejected', 'expired'
  applied_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vertical Module Features Tracking
CREATE TABLE IF NOT EXISTS module_feature_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_id VARCHAR(100) NOT NULL,
  feature_id VARCHAR(100) NOT NULL,
  usage_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, module_id, feature_id)
);

-- Business Intelligence Views
CREATE TABLE IF NOT EXISTS bi_dashboards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dashboard_name VARCHAR(255) NOT NULL,
  dashboard_config JSONB NOT NULL,
  widgets JSONB DEFAULT '[]',
  permissions JSONB DEFAULT '{}',
  is_public BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Metrics Tracking
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_name VARCHAR(100) NOT NULL,
  metric_value DECIMAL(15,4) NOT NULL,
  unit VARCHAR(50),
  tags JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_modules_tenant_id 
  ON tenant_modules(tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_metrics_tenant_period 
  ON analytics_metrics_cache(tenant_id, metric_type, period_start, period_end);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_metrics_expires 
  ON analytics_metrics_cache(expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_models_tenant_type 
  ON ml_models(tenant_id, model_type, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_predictions_tenant_type 
  ON ml_predictions(tenant_id, prediction_type, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_predictions_expires 
  ON ml_predictions(expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anomaly_detections_tenant_status 
  ON anomaly_detections(tenant_id, status, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_analytics_tenant_customer 
  ON customer_analytics(tenant_id, customer_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_analytics_expires 
  ON customer_analytics(expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_optimizations_tenant_status 
  ON revenue_optimizations(tenant_id, status, expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_module_feature_usage_tenant_module 
  ON module_feature_usage(tenant_id, module_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_metrics_tenant_name 
  ON performance_metrics(tenant_id, metric_name, recorded_at);

-- RLS Policies

-- Tenant Modules
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_modules_tenant_isolation ON tenant_modules
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Analytics Metrics Cache
ALTER TABLE analytics_metrics_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_metrics_tenant_isolation ON analytics_metrics_cache
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- ML Models
ALTER TABLE ml_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY ml_models_tenant_isolation ON ml_models
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- ML Predictions
ALTER TABLE ml_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ml_predictions_tenant_isolation ON ml_predictions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Anomaly Detections
ALTER TABLE anomaly_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY anomaly_detections_tenant_isolation ON anomaly_detections
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Customer Analytics
ALTER TABLE customer_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_analytics_tenant_isolation ON customer_analytics
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Revenue Optimizations
ALTER TABLE revenue_optimizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY revenue_optimizations_tenant_isolation ON revenue_optimizations
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Module Feature Usage
ALTER TABLE module_feature_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY module_feature_usage_tenant_isolation ON module_feature_usage
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- BI Dashboards
ALTER TABLE bi_dashboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY bi_dashboards_tenant_isolation ON bi_dashboards
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Performance Metrics
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_metrics_tenant_isolation ON performance_metrics
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Functions for Analytics

-- Function to calculate customer lifetime value
CREATE OR REPLACE FUNCTION calculate_customer_ltv(
  p_tenant_id UUID,
  p_customer_id UUID
) RETURNS DECIMAL AS $$
DECLARE
  total_spent DECIMAL;
  avg_booking_frequency DECIMAL;
  avg_booking_value DECIMAL;
  predicted_lifespan_months INTEGER := 24; -- 2 years default
BEGIN
  -- Get historical spending
  SELECT COALESCE(SUM(amount), 0)
  INTO total_spent
  FROM transactions 
  WHERE tenant_id = p_tenant_id 
    AND metadata->>'customer_id' = p_customer_id::TEXT
    AND status = 'completed';
  
  -- Get booking frequency (bookings per month)
  SELECT COUNT(*)::DECIMAL / GREATEST(
    EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / (30 * 24 * 60 * 60), 1
  )
  INTO avg_booking_frequency
  FROM reservations 
  WHERE tenant_id = p_tenant_id 
    AND customer_id = p_customer_id
    AND status != 'cancelled';
  
  -- Get average booking value
  SELECT COALESCE(AVG(amount), 0)
  INTO avg_booking_value
  FROM transactions 
  WHERE tenant_id = p_tenant_id 
    AND metadata->>'customer_id' = p_customer_id::TEXT
    AND status = 'completed';
  
  -- Calculate predicted LTV
  RETURN (avg_booking_frequency * avg_booking_value * predicted_lifespan_months);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to detect booking anomalies
CREATE OR REPLACE FUNCTION detect_booking_anomalies(
  p_tenant_id UUID,
  p_lookback_days INTEGER DEFAULT 7
) RETURNS TABLE (
  anomaly_type VARCHAR,
  severity VARCHAR,
  description TEXT,
  score DECIMAL,
  data_points JSONB
) AS $$
DECLARE
  avg_bookings_per_day DECIMAL;
  recent_bookings_per_day DECIMAL;
  threshold_multiplier DECIMAL := 2.0; -- 2x normal is anomaly
BEGIN
  -- Calculate average bookings per day (last 30 days excluding recent period)
  SELECT COUNT(*)::DECIMAL / 30
  INTO avg_bookings_per_day
  FROM reservations
  WHERE tenant_id = p_tenant_id
    AND created_at >= NOW() - INTERVAL '30 days'
    AND created_at <= NOW() - INTERVAL '7 days';
  
  -- Calculate recent bookings per day
  SELECT COUNT(*)::DECIMAL / p_lookback_days
  INTO recent_bookings_per_day
  FROM reservations
  WHERE tenant_id = p_tenant_id
    AND created_at >= NOW() - (p_lookback_days || ' days')::INTERVAL;
  
  -- Check for anomalies
  IF recent_bookings_per_day > (avg_bookings_per_day * threshold_multiplier) THEN
    RETURN QUERY SELECT
      'booking_spike'::VARCHAR,
      CASE 
        WHEN recent_bookings_per_day > (avg_bookings_per_day * 3) THEN 'high'::VARCHAR
        WHEN recent_bookings_per_day > (avg_bookings_per_day * 2) THEN 'medium'::VARCHAR
        ELSE 'low'::VARCHAR
      END,
      'Unusual spike in booking volume detected'::TEXT,
      (recent_bookings_per_day / avg_bookings_per_day - 1)::DECIMAL,
      jsonb_build_object(
        'avg_bookings_per_day', avg_bookings_per_day,
        'recent_bookings_per_day', recent_bookings_per_day,
        'multiplier', recent_bookings_per_day / NULLIF(avg_bookings_per_day, 0)
      );
  END IF;
  
  IF recent_bookings_per_day < (avg_bookings_per_day / threshold_multiplier) AND avg_bookings_per_day > 0 THEN
    RETURN QUERY SELECT
      'booking_drop'::VARCHAR,
      CASE 
        WHEN recent_bookings_per_day < (avg_bookings_per_day / 3) THEN 'high'::VARCHAR
        WHEN recent_bookings_per_day < (avg_bookings_per_day / 2) THEN 'medium'::VARCHAR
        ELSE 'low'::VARCHAR
      END,
      'Significant drop in booking volume detected'::TEXT,
      (1 - recent_bookings_per_day / avg_bookings_per_day)::DECIMAL,
      jsonb_build_object(
        'avg_bookings_per_day', avg_bookings_per_day,
        'recent_bookings_per_day', recent_bookings_per_day,
        'drop_percentage', (1 - recent_bookings_per_day / avg_bookings_per_day) * 100
      );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up expired records
CREATE OR REPLACE FUNCTION cleanup_expired_analytics() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Clean expired analytics cache
  DELETE FROM analytics_metrics_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Clean expired ML predictions
  DELETE FROM ml_predictions WHERE expires_at < NOW();
  
  -- Clean expired customer analytics
  DELETE FROM customer_analytics WHERE expires_at < NOW();
  
  -- Clean expired revenue optimizations
  UPDATE revenue_optimizations 
  SET status = 'expired' 
  WHERE expires_at < NOW() AND status = 'pending';
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create scheduled job for cleanup (if pg_cron is available)
-- SELECT cron.schedule('cleanup-analytics', '0 2 * * *', 'SELECT cleanup_expired_analytics();');

-- Triggers for automatic updates
CREATE OR REPLACE FUNCTION update_customer_analytics_on_booking() 
RETURNS TRIGGER AS $$
BEGIN
  -- Invalidate customer analytics cache when new booking is created
  DELETE FROM customer_analytics 
  WHERE tenant_id = NEW.tenant_id AND customer_id = NEW.customer_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_customer_analytics_on_booking
  AFTER INSERT OR UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_analytics_on_booking();

-- Insert default ML models for new tenants
INSERT INTO ml_models (tenant_id, model_type, model_name, version, status, parameters)
SELECT 
  t.id,
  unnest(ARRAY['scheduling', 'demand_forecasting', 'anomaly_detection', 'pricing_optimization']),
  unnest(ARRAY['Basic Scheduler', 'Demand Predictor', 'Anomaly Detector', 'Price Optimizer']),
  '1.0.0',
  'ready',
  '{}'::jsonb
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ml_models m WHERE m.tenant_id = t.id
);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;