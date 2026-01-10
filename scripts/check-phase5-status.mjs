#!/usr/bin/env node

/**
 * Phase 5 Status Checker
 * Checks the status and health of all Phase 5 features
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkPhase5Status() {
  console.log('📊 Phase 5 Feature Status Report');
  console.log('================================');

  const results = {
    database: { status: 'unknown', details: {} },
    analytics: { status: 'unknown', details: {} },
    ml: { status: 'unknown', details: {} },
    modules: { status: 'unknown', details: {} },
    performance: { status: 'unknown', details: {} }
  };

  try {
    // Check database tables
    await checkDatabaseTables(results);

    // Check analytics system
    await checkAnalyticsSystem(results);

    // Check ML models
    await checkMLModels(results);

    // Check vertical modules
    await checkVerticalModules(results);

    // Check performance metrics
    await checkPerformanceMetrics(results);

    // Print summary
    printStatusReport(results);

  } catch (error) {
    console.error('❌ Status check failed:', error.message);
    process.exit(1);
  }
}

async function checkDatabaseTables(results) {
  console.log('\n🗄️  Database Schema Status');
  console.log('--------------------------');

  const requiredTables = [
    'tenant_modules',
    'analytics_metrics_cache',
    'ml_models',
    'ml_predictions',
    'anomaly_detections',
    'customer_analytics',
    'revenue_optimizations',
    'module_feature_usage',
    'bi_dashboards',
    'performance_metrics'
  ];

  const missingTables = [];
  const existingTables = [];

  for (const table of requiredTables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('*')
        .limit(1);

      if (error) {
        if (error.message.includes('does not exist') || error.message.includes('relation')) {
          missingTables.push(table);
          console.log(`  ❌ ${table} - Missing`);
        } else {
          existingTables.push(table);
          console.log(`  ⚠️  ${table} - Accessible but may have issues`);
        }
      } else {
        existingTables.push(table);
        console.log(`  ✅ ${table} - OK`);
      }
    } catch (err) {
      missingTables.push(table);
      console.log(`  ❌ ${table} - Error: ${err.message}`);
    }
  }

  results.database = {
    status: missingTables.length === 0 ? 'healthy' : missingTables.length < requiredTables.length ? 'partial' : 'error',
    details: {
      total_tables: requiredTables.length,
      existing_tables: existingTables.length,
      missing_tables: missingTables
    }
  };
}

async function checkAnalyticsSystem(results) {
  console.log('\n📊 Analytics System Status');
  console.log('--------------------------');

  try {
    // Check analytics cache
    const { data: cacheData, error: cacheError } = await supabase
      .from('analytics_metrics_cache')
      .select('*')
      .limit(5);

    if (cacheError) {
      console.log('  ❌ Analytics cache - Not accessible');
      results.analytics.status = 'error';
      return;
    }

    console.log(`  ✅ Analytics cache - ${cacheData?.length || 0} metrics cached`);

    // Check recent calculations
    const { data: recentMetrics } = await supabase
      .from('analytics_metrics_cache')
      .select('*')
      .gte('calculated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('calculated_at', { ascending: false })
      .limit(10);

    console.log(`  ✅ Recent calculations - ${recentMetrics?.length || 0} in last 24h`);

    // Check tenants with analytics
    const { data: tenantAnalytics } = await supabase
      .from('analytics_metrics_cache')
      .select('tenant_id')
      .limit(100);

    const uniqueTenants = new Set(tenantAnalytics?.map(t => t.tenant_id) || []);
    console.log(`  ✅ Active tenants - ${uniqueTenants.size} tenants have analytics`);

    results.analytics = {
      status: 'healthy',
      details: {
        cached_metrics: cacheData?.length || 0,
        recent_calculations: recentMetrics?.length || 0,
        active_tenants: uniqueTenants.size
      }
    };

  } catch (error) {
    console.log(`  ❌ Analytics system - Error: ${error.message}`);
    results.analytics = {
      status: 'error',
      details: { error: error.message }
    };
  }
}

async function checkMLModels(results) {
  console.log('\n🧠 ML Models Status');
  console.log('-------------------');

  try {
    // Check ML models
    const { data: models, error: modelsError } = await supabase
      .from('ml_models')
      .select('*');

    if (modelsError) {
      console.log('  ❌ ML models - Not accessible');
      results.ml.status = 'error';
      return;
    }

    const modelsByStatus = models?.reduce((acc, model) => {
      acc[model.status] = (acc[model.status] || 0) + 1;
      return acc;
    }, {}) || {};

    console.log(`  ✅ Total models - ${models?.length || 0}`);
    Object.entries(modelsByStatus).forEach(([status, count]) => {
      console.log(`    ${status}: ${count}`);
    });

    // Check recent predictions
    const { data: predictions } = await supabase
      .from('ml_predictions')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    console.log(`  ✅ Recent predictions - ${predictions?.length || 0} in last 24h`);

    // Check anomaly detections
    const { data: anomalies } = await supabase
      .from('anomaly_detections')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log(`  ✅ Active anomalies - ${anomalies?.length || 0}`);

    results.ml = {
      status: models?.length > 0 ? 'healthy' : 'warning',
      details: {
        total_models: models?.length || 0,
        models_by_status: modelsByStatus,
        recent_predictions: predictions?.length || 0,
        active_anomalies: anomalies?.length || 0
      }
    };

  } catch (error) {
    console.log(`  ❌ ML system - Error: ${error.message}`);
    results.ml = {
      status: 'error',
      details: { error: error.message }
    };
  }
}

async function checkVerticalModules(results) {
  console.log('\n📦 Vertical Modules Status');
  console.log('--------------------------');

  try {
    // Check tenant modules
    const { data: tenantModules, error: modulesError } = await supabase
      .from('tenant_modules')
      .select('*');

    if (modulesError) {
      console.log('  ❌ Tenant modules - Not accessible');
      results.modules.status = 'error';
      return;
    }

    console.log(`  ✅ Tenant module configs - ${tenantModules?.length || 0}`);

    // Analyze module usage
    let totalActiveModules = 0;
    const verticalCounts = { beauty: 0, hospitality: 0, medicine: 0 };

    tenantModules?.forEach(config => {
      const registry = config.registry_data || {};
      totalActiveModules += (registry.active || []).length;
      
      // Count by vertical (simplified analysis)
      (registry.active || []).forEach(moduleId => {
        if (moduleId.includes('beauty')) verticalCounts.beauty++;
        if (moduleId.includes('hospitality')) verticalCounts.hospitality++;
        if (moduleId.includes('medical')) verticalCounts.medicine++;
      });
    });

    console.log(`  ✅ Active modules - ${totalActiveModules}`);
    console.log(`    Beauty: ${verticalCounts.beauty}`);
    console.log(`    Hospitality: ${verticalCounts.hospitality}`);
    console.log(`    Medicine: ${verticalCounts.medicine}`);

    // Check module usage tracking
    const { data: usageData } = await supabase
      .from('module_feature_usage')
      .select('*')
      .limit(100);

    console.log(`  ✅ Feature usage tracking - ${usageData?.length || 0} records`);

    results.modules = {
      status: tenantModules?.length > 0 ? 'healthy' : 'warning',
      details: {
        configured_tenants: tenantModules?.length || 0,
        total_active_modules: totalActiveModules,
        vertical_distribution: verticalCounts,
        usage_records: usageData?.length || 0
      }
    };

  } catch (error) {
    console.log(`  ❌ Modules system - Error: ${error.message}`);
    results.modules = {
      status: 'error',
      details: { error: error.message }
    };
  }
}

async function checkPerformanceMetrics(results) {
  console.log('\n⚡ Performance Monitoring Status');
  console.log('--------------------------------');

  try {
    // Check performance metrics
    const { data: perfMetrics, error: perfError } = await supabase
      .from('performance_metrics')
      .select('*')
      .gte('recorded_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('recorded_at', { ascending: false })
      .limit(100);

    if (perfError) {
      console.log('  ❌ Performance metrics - Not accessible');
      results.performance.status = 'error';
      return;
    }

    console.log(`  ✅ Performance metrics - ${perfMetrics?.length || 0} records in 24h`);

    // Analyze metrics by type
    const metricTypes = perfMetrics?.reduce((acc, metric) => {
      acc[metric.metric_name] = (acc[metric.metric_name] || 0) + 1;
      return acc;
    }, {}) || {};

    Object.entries(metricTypes).forEach(([type, count]) => {
      console.log(`    ${type}: ${count} records`);
    });

    results.performance = {
      status: perfMetrics?.length > 0 ? 'healthy' : 'warning',
      details: {
        recent_records: perfMetrics?.length || 0,
        metric_types: Object.keys(metricTypes).length,
        metrics_breakdown: metricTypes
      }
    };

  } catch (error) {
    console.log(`  ❌ Performance monitoring - Error: ${error.message}`);
    results.performance = {
      status: 'error',
      details: { error: error.message }
    };
  }
}

function printStatusReport(results) {
  console.log('\n📋 Overall Status Summary');
  console.log('=========================');

  const statusIcons = {
    healthy: '✅',
    warning: '⚠️',
    partial: '🔶',
    error: '❌',
    unknown: '❓'
  };

  Object.entries(results).forEach(([component, result]) => {
    console.log(`${statusIcons[result.status]} ${component.toUpperCase()}: ${result.status.toUpperCase()}`);
  });

  // Overall health score
  const scores = { healthy: 3, partial: 2, warning: 1, error: 0, unknown: 0 };
  const totalScore = Object.values(results).reduce((sum, result) => sum + scores[result.status], 0);
  const maxScore = Object.keys(results).length * 3;
  const healthPercentage = Math.round((totalScore / maxScore) * 100);

  console.log(`\n🎯 Overall Health Score: ${healthPercentage}%`);

  if (healthPercentage >= 90) {
    console.log('🎉 Phase 5 is running optimally!');
  } else if (healthPercentage >= 70) {
    console.log('👍 Phase 5 is mostly healthy with minor issues.');
  } else if (healthPercentage >= 50) {
    console.log('⚠️  Phase 5 has some significant issues that need attention.');
  } else {
    console.log('🚨 Phase 5 has major issues and requires immediate attention.');
  }

  // Recommendations
  console.log('\n💡 Recommendations:');
  if (results.database.status === 'error') {
    console.log('- Run the Phase 5 migration: npm run phase5:setup');
  }
  if (results.analytics.status === 'warning') {
    console.log('- Refresh analytics cache: npm run analytics:cache:refresh');
  }
  if (results.ml.status === 'warning') {
    console.log('- Initialize ML models: npm run ml:train');
  }
  if (results.modules.status === 'warning') {
    console.log('- Configure vertical modules: npm run modules:sync');
  }
  if (results.performance.status === 'warning') {
    console.log('- Check system performance and logs');
  }
}

// Run status check
checkPhase5Status().catch(console.error);