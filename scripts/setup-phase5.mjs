#!/usr/bin/env node

/**
 * Phase 5 Setup Script
 * Initializes all Phase 5 features: Analytics, Vertical Modules, and ML Integration
 */


import { createServerSupabaseClient } from '../src/lib/supabase/server';
import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase configuration');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createServerSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function setupPhase5() {
  console.log('🚀 Setting up Phase 5: Advanced Features');
  console.log('==========================================');

  try {
    // 1. Run database migration
    console.log('📊 Setting up database schema...');
    await runMigration();

    // 2. Initialize default ML models
    console.log('🧠 Initializing ML models...');
    await initializeMLModels();

    // 3. Set up analytics cache
    console.log('📈 Setting up analytics infrastructure...');
    await setupAnalyticsInfrastructure();

    // 4. Initialize vertical modules
    console.log('📦 Initializing vertical modules...');
    await initializeVerticalModules();

    // 5. Create default dashboards
    console.log('📱 Creating default dashboards...');
    await createDefaultDashboards();

    // 6. Set up performance monitoring
    console.log('⚡ Setting up performance monitoring...');
    await setupPerformanceMonitoring();

    console.log('\n✅ Phase 5 setup completed successfully!');
    console.log('\nNext steps:');
    console.log('- Access the Phase 5 dashboard at /admin/phase5');
    console.log('- Configure vertical modules for your business type');
    console.log('- Review ML predictions and analytics');
    console.log('- Monitor anomaly detection alerts');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

async function runMigration() {
  try {
    const migrationPath = path.join(process.cwd(), 'db', 'migrations', '028_phase5_features.sql');
    // Check if migration file exists
    await fs.access(migrationPath);
    
    // Execute migration (in a real scenario, use proper migration tool)
    console.log('  - Running migration 028_phase5_features.sql');
    console.log('  ℹ️  Note: Please run this migration through your preferred migration tool');
    console.log('     Migration file: db/migrations/028_phase5_features.sql');
  } catch {
    console.log('  ⚠️  Migration file not found or inaccessible');
  }
}

async function initializeMLModels() {
  const modelTypes = [
    {
      model_type: 'scheduling',
      model_name: 'Optimal Slot Predictor',
      version: '1.0.0',
      parameters: {
        algorithm: 'ensemble',
        features: ['historical_demand', 'staff_availability', 'seasonal_trends'],
        confidence_threshold: 0.7
      }
    },
    {
      model_type: 'demand_forecasting',
      model_name: 'Booking Demand Forecaster',
      version: '1.0.0',
      parameters: {
        algorithm: 'time_series',
        lookback_days: 90,
        forecast_horizon: 30,
        seasonal_patterns: true
      }
    },
    {
      model_type: 'anomaly_detection',
      model_name: 'Business Anomaly Detector',
      version: '1.0.0',
      parameters: {
        algorithm: 'isolation_forest',
        sensitivity: 'medium',
        window_size: 7,
        threshold: 0.8
      }
    },
    {
      model_type: 'pricing_optimization',
      model_name: 'Dynamic Pricing Optimizer',
      version: '1.0.0',
      parameters: {
        algorithm: 'elasticity_model',
        price_range_limit: 0.3,
        demand_sensitivity: 'medium',
        competitor_tracking: true
      }
    }
  ];

  // Get all tenants
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id');

  for (const tenant of tenants || []) {
    for (const model of modelTypes) {
      const { error } = await supabase
        .from('ml_models')
        .upsert({
          tenant_id: tenant.id,
          ...model,
          status: 'ready',
          last_trained: new Date().toISOString()
        });

      if (error && !error.message?.includes('duplicate')) {
        console.error(`    ❌ Failed to create ${model.model_name} for tenant ${tenant.id}:`, error.message || error);
      }
    }
  }

  console.log(`  ✅ Initialized ML models for ${tenants?.length || 0} tenants`);
}

async function setupAnalyticsInfrastructure() {
  // Create initial analytics metrics cache entries
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id');

  const baseMetrics = [
    'total_bookings',
    'total_revenue',
    'cancellation_rate',
    'no_show_rate',
    'staff_utilization',
    'customer_satisfaction',
    'average_booking_value'
  ];

  for (const tenant of tenants || []) {
    for (const metric of baseMetrics) {
      const { error } = await supabase
        .from('analytics_metrics_cache')
        .upsert({
          tenant_id: tenant.id,
          metric_type: 'business',
          metric_key: metric,
          value: 0,
          period_type: 'month',
          period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
          period_end: new Date().toISOString(),
          metadata: { status: 'initial' }
        });

      if (error && !error.message?.includes('duplicate')) {
        console.error(`    ❌ Failed to create metric ${metric} for tenant ${tenant.id}:`, error.message || error);
      }
    }
  }

  console.log('  ✅ Analytics infrastructure set up');
}

async function initializeVerticalModules() {
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, metadata');

  for (const tenant of tenants || []) {
    // Initialize empty module registry for each tenant
    const registryData = {
      modules: {},
      installed: [],
      active: [],
      configurations: {},
      last_updated: new Date().toISOString()
    };

    const { error } = await supabase
      .from('tenant_modules')
      .upsert({
        tenant_id: tenant.id,
        registry_data: registryData
      });

    if (error && !error.message.includes('duplicate')) {
      console.error(`    ❌ Failed to initialize modules for tenant ${tenant.id}:`, error.message);
    }
  }

  console.log('  ✅ Vertical modules initialized');
}

async function createDefaultDashboards() {
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id');

  const defaultDashboards = [
    {
      dashboard_name: 'Executive Overview',
      dashboard_config: {
        layout: 'grid',
        refresh_interval: 300, // 5 minutes
        auto_refresh: true
      },
      widgets: [
        { type: 'metric', title: 'Total Revenue', size: 'small', position: { x: 0, y: 0 } },
        { type: 'metric', title: 'Bookings Today', size: 'small', position: { x: 1, y: 0 } },
        { type: 'chart', title: 'Revenue Trend', size: 'large', position: { x: 0, y: 1 } },
        { type: 'table', title: 'Top Performers', size: 'medium', position: { x: 2, y: 1 } }
      ]
    },
    {
      dashboard_name: 'Operations Dashboard',
      dashboard_config: {
        layout: 'tabs',
        refresh_interval: 60, // 1 minute
        auto_refresh: true
      },
      widgets: [
        { type: 'calendar', title: 'Today\'s Schedule', size: 'large', position: { x: 0, y: 0 } },
        { type: 'alerts', title: 'Active Alerts', size: 'medium', position: { x: 1, y: 0 } },
        { type: 'metrics', title: 'Staff Utilization', size: 'medium', position: { x: 0, y: 1 } }
      ]
    },
    {
      dashboard_name: 'ML Insights',
      dashboard_config: {
        layout: 'dashboard',
        refresh_interval: 900, // 15 minutes
        auto_refresh: false
      },
      widgets: [
        { type: 'predictions', title: 'Scheduling Predictions', size: 'large', position: { x: 0, y: 0 } },
        { type: 'anomalies', title: 'Anomaly Detection', size: 'medium', position: { x: 1, y: 0 } },
        { type: 'optimization', title: 'Pricing Optimization', size: 'medium', position: { x: 0, y: 1 } }
      ]
    }
  ];

  for (const tenant of tenants || []) {
    for (const dashboard of defaultDashboards) {
      const { error } = await supabase
        .from('bi_dashboards')
        .upsert({
          tenant_id: tenant.id,
          ...dashboard,
          is_public: false
        });

      if (error && !error.message.includes('duplicate')) {
        console.error(`    ❌ Failed to create dashboard ${dashboard.dashboard_name} for tenant ${tenant.id}:`, error.message);
      }
    }
  }

  console.log('  ✅ Default dashboards created');
}

async function setupPerformanceMonitoring() {
  // Initialize performance tracking
  const performanceMetrics = [
    'api_response_time',
    'database_query_time',
    'ml_prediction_latency',
    'cache_hit_ratio',
    'error_rate',
    'user_session_duration'
  ];

  const { data: tenants } = await supabase
    .from('tenants')
    .select('id');

  for (const tenant of tenants || []) {
    for (const metric of performanceMetrics) {
      const { error } = await supabase
        .from('performance_metrics')
        .insert({
          tenant_id: tenant.id,
          metric_name: metric,
          metric_value: 0,
          unit: metric.includes('time') || metric.includes('latency') ? 'ms' : 
                 metric.includes('ratio') || metric.includes('rate') ? 'percentage' : 'count',
          tags: { status: 'initial' }
        });

      if (error && !error.message.includes('duplicate')) {
        console.error(`    ❌ Failed to initialize metric ${metric} for tenant ${tenant.id}:`, error.message);
      }
    }
  }

  console.log('  ✅ Performance monitoring set up');
}

// Run setup
setupPhase5().catch(console.error);