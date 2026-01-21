#!/usr/bin/env node

/**
 * Scheduler Performance Benchmark
 * 
 * Compares performance between naive scheduler and OptimizedScheduler
 * with precomputed availability slots.
 * 
 * Usage:
 * node scripts/test-scheduler-performance.mjs [--staff-count=10] [--days=7] [--queries=1000]
 * 
 * Environment Variables:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 */

import { createServerSupabaseClient } from '../src/lib/supabase/server';
import OptimizedScheduler from '../src/lib/optimizedScheduler.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('scheduler-benchmark');
// const meter = metrics.getMeter('scheduler-benchmark'); // Unused for now, kept for future metrics implementation

// Configuration
const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  staffCount: 10,
  days: 7,
  queries: 1000,
};

// Parse command line arguments
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--staff-count=')) {
    config.staffCount = parseInt(arg.split('=')[1]);
  } else if (arg.startsWith('--days=')) {
    config.days = parseInt(arg.split('=')[1]);
  } else if (arg.startsWith('--queries=')) {
    config.queries = parseInt(arg.split('=')[1]);
  }
}

console.log('Scheduler Performance Benchmark Configuration:', config);

async function main() {
  const span = tracer.startSpan('scheduler_benchmark.main');
  
  try {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    // Initialize Supabase client
    const supabase = createServerSupabaseClient(config.supabaseUrl, config.supabaseServiceKey);
    
    // Initialize optimized scheduler
    const scheduler = new OptimizedScheduler(supabase);

    console.log('🏁 Starting scheduler performance benchmark...');

    // Phase 1: Setup test data
    console.log('📊 Phase 1: Setting up test data...');
    const { staffIds, serviceIds } = await setupTestData(supabase);

    // Phase 2: Precompute availability for optimized scheduler
    console.log('⚡ Phase 2: Precomputing availability slots...');
    const precomputeStartTime = Date.now();
    
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + config.days);

    for (const staffId of staffIds) {
      await scheduler.precomputeAvailability(staffId, startDate, endDate);
    }

    const precomputeTime = Date.now() - precomputeStartTime;
    console.log(`✅ Precomputation completed in ${precomputeTime}ms`);

    // Phase 3: Benchmark naive vs optimized scheduler
    console.log('🚀 Phase 3: Running performance benchmark...');
    
    const naiveResults = await benchmarkNaiveScheduler(supabase, staffIds, serviceIds);
    const optimizedResults = await benchmarkOptimizedScheduler(scheduler, staffIds, serviceIds);

    // Phase 4: Display results
    displayResults({
      precomputeTime,
      naive: naiveResults,
      optimized: optimizedResults,
      config,
    });

    // Phase 5: Cleanup test data
    console.log('🧹 Phase 5: Cleaning up test data...');
    await cleanupTestData(supabase, staffIds, serviceIds);

    span.setAttribute('benchmark.queries', config.queries);
    span.setAttribute('benchmark.staff_count', config.staffCount);
    span.setAttribute('benchmark.precompute_time_ms', precomputeTime);
    span.setAttribute('benchmark.naive_avg_ms', naiveResults.avgQueryTime);
    span.setAttribute('benchmark.optimized_avg_ms', optimizedResults.avgQueryTime);

  } catch (error) {
    span.recordException(error);
    console.error('❌ Scheduler benchmark error:', error);
    process.exit(1);
  } finally {
    span.end();
  }
}

async function setupTestData(supabase) {
  console.log(`  📝 Creating ${config.staffCount} test staff members...`);
  
  const staffIds = [];
  const serviceIds = [];

  // Create test tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .insert({
      name: 'Benchmark Test Tenant',
      slug: 'benchmark-test',
    })
    .select('id')
    .single();

  // Create test services
  for (let i = 0; i < 3; i++) {
    const { data: service } = await supabase
      .from('services')
      .insert({
        tenant_id: tenant.id,
        name: `Test Service ${i + 1}`,
        duration_minutes: 60,
        price: 1000,
      })
      .select('id')
      .single();
    
    serviceIds.push(service.id);
  }

  // Create test staff
  for (let i = 0; i < config.staffCount; i++) {
    const { data: staff } = await supabase
      .from('staff')
      .insert({
        tenant_id: tenant.id,
        name: `Test Staff ${i + 1}`,
        email: `staff${i + 1}@benchmark.test`,
      })
      .select('id')
      .single();
    
    staffIds.push(staff.id);

    // Create working hours for each staff member
    const workingHours = [
      { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
      { day_of_week: 2, start_time: '09:00', end_time: '17:00' },
      { day_of_week: 3, start_time: '09:00', end_time: '17:00' },
      { day_of_week: 4, start_time: '09:00', end_time: '17:00' },
      { day_of_week: 5, start_time: '09:00', end_time: '17:00' },
    ];

    for (const hours of workingHours) {
      await supabase
        .from('staff_schedules')
        .insert({
          staff_id: staff.id,
          ...hours,
        });
    }

    // Assign services to staff
    for (const serviceId of serviceIds) {
      await supabase
        .from('staff_services')
        .insert({
          staff_id: staff.id,
          service_id: serviceId,
        });
    }
  }

  console.log(`  ✅ Created ${staffIds.length} staff and ${serviceIds.length} services`);
  return { staffIds, serviceIds };
}

async function benchmarkNaiveScheduler(supabase, staffIds) {
  console.log(`  🐌 Benchmarking naive scheduler with ${config.queries} queries...`);
  
  const queryTimes = [];
  const successCount = { total: 0, found: 0 };

  for (let i = 0; i < config.queries; i++) {
    const startTime = Date.now();
    
    try {
      // Simulate naive availability query
      const randomStaffId = staffIds[Math.floor(Math.random() * staffIds.length)];
      const randomDate = new Date();
      randomDate.setDate(randomDate.getDate() + Math.floor(Math.random() * config.days));
      
      // Naive query: check existing reservations for conflicts
      const { data: existingReservations } = await supabase
        .from('reservations')
        .select('start_time, end_time')
        .eq('staff_id', randomStaffId)
        .gte('start_time', randomDate.toISOString().split('T')[0])
        .lt('start_time', new Date(randomDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

      // Simulate availability calculation (simplified)
      const availableSlots = generateTimeSlots(randomDate)
        .filter(slot => !hasConflict(slot, existingReservations || []));

      successCount.total++;
      if (availableSlots.length > 0) {
        successCount.found++;
      }

    } catch (error) {
      console.warn(`Query ${i + 1} failed:`, error.message);
    }

    const queryTime = Date.now() - startTime;
    queryTimes.push(queryTime);

    if ((i + 1) % 100 === 0) {
      console.log(`    Progress: ${i + 1}/${config.queries} queries completed`);
    }
  }

  const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
  const minQueryTime = Math.min(...queryTimes);
  const maxQueryTime = Math.max(...queryTimes);

  return {
    avgQueryTime: Math.round(avgQueryTime),
    minQueryTime,
    maxQueryTime,
    successRate: (successCount.found / successCount.total) * 100,
    totalQueries: config.queries,
  };
}

async function benchmarkOptimizedScheduler(scheduler, staffIds, serviceIds) {
  console.log(`  ⚡ Benchmarking optimized scheduler with ${config.queries} queries...`);
  
  const queryTimes = [];
  const successCount = { total: 0, found: 0 };

  for (let i = 0; i < config.queries; i++) {
    const startTime = Date.now();
    
    try {
      const randomStaffId = staffIds[Math.floor(Math.random() * staffIds.length)];
      const randomServiceId = serviceIds[Math.floor(Math.random() * serviceIds.length)];
      const randomDate = new Date();
      randomDate.setDate(randomDate.getDate() + Math.floor(Math.random() * config.days));
      
      const endDate = new Date(randomDate);
      endDate.setDate(endDate.getDate() + 1);

      // Use optimized scheduler
      const availableSlots = await scheduler.findOptimalSlots({
        service_id: randomServiceId,
        staff_id: randomStaffId,
        start_date: randomDate,
        end_date: endDate,
        max_results: 10,
      });

      successCount.total++;
      if (availableSlots.length > 0) {
        successCount.found++;
      }

    } catch (error) {
      console.warn(`Query ${i + 1} failed:`, error.message);
    }

    const queryTime = Date.now() - startTime;
    queryTimes.push(queryTime);

    if ((i + 1) % 100 === 0) {
      console.log(`    Progress: ${i + 1}/${config.queries} queries completed`);
    }
  }

  const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
  const minQueryTime = Math.min(...queryTimes);
  const maxQueryTime = Math.max(...queryTimes);

  return {
    avgQueryTime: Math.round(avgQueryTime),
    minQueryTime,
    maxQueryTime,
    successRate: (successCount.found / successCount.total) * 100,
    totalQueries: config.queries,
  };
}

function generateTimeSlots(date) {
  const slots = [];
  const startHour = 9; // 9 AM
  const endHour = 17; // 5 PM
  const slotDuration = 60; // 60 minutes

  for (let hour = startHour; hour < endHour; hour++) {
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

    slots.push({
      start_time: slotStart.toISOString(),
      end_time: slotEnd.toISOString(),
    });
  }

  return slots;
}

function hasConflict(slot, existingReservations) {
  const slotStart = new Date(slot.start_time).getTime();
  const slotEnd = new Date(slot.end_time).getTime();

  return existingReservations.some(reservation => {
    const resStart = new Date(reservation.start_time).getTime();
    const resEnd = new Date(reservation.end_time).getTime();
    
    return (slotStart < resEnd && slotEnd > resStart);
  });
}

function displayResults(results) {
  console.log('\n📊 SCHEDULER PERFORMANCE BENCHMARK RESULTS');
  console.log('=' .repeat(60));
  
  console.log('\n🔧 Configuration:');
  console.log(`   Staff Count: ${results.config.staffCount}`);
  console.log(`   Days Range: ${results.config.days}`);
  console.log(`   Total Queries: ${results.config.queries}`);
  
  console.log('\n⚡ Precomputation:');
  console.log(`   Time: ${results.precomputeTime}ms`);
  console.log(`   Per Staff: ${Math.round(results.precomputeTime / results.config.staffCount)}ms`);
  
  console.log('\n🐌 Naive Scheduler:');
  console.log(`   Average Query Time: ${results.naive.avgQueryTime}ms`);
  console.log(`   Min Query Time: ${results.naive.minQueryTime}ms`);
  console.log(`   Max Query Time: ${results.naive.maxQueryTime}ms`);
  console.log(`   Success Rate: ${results.naive.successRate.toFixed(2)}%`);
  
  console.log('\n⚡ Optimized Scheduler:');
  console.log(`   Average Query Time: ${results.optimized.avgQueryTime}ms`);
  console.log(`   Min Query Time: ${results.optimized.minQueryTime}ms`);
  console.log(`   Max Query Time: ${results.optimized.maxQueryTime}ms`);
  console.log(`   Success Rate: ${results.optimized.successRate.toFixed(2)}%`);
  
  const speedImprovement = results.naive.avgQueryTime / results.optimized.avgQueryTime;
  const efficiencyGain = ((results.naive.avgQueryTime - results.optimized.avgQueryTime) / results.naive.avgQueryTime) * 100;
  
  console.log('\n🏆 Performance Comparison:');
  console.log(`   Speed Improvement: ${speedImprovement.toFixed(2)}x faster`);
  console.log(`   Efficiency Gain: ${efficiencyGain.toFixed(2)}% reduction in query time`);
  console.log(`   Total Time Saved: ${(results.naive.avgQueryTime - results.optimized.avgQueryTime) * results.config.queries}ms`);
  
  if (speedImprovement > 1.5) {
    console.log(`\n✅ RESULT: Optimized scheduler shows significant performance improvement!`);
  } else if (speedImprovement > 1.1) {
    console.log(`\n⚠️  RESULT: Optimized scheduler shows modest improvement.`);
  } else {
    console.log(`\n❌ RESULT: Optimized scheduler shows little to no improvement.`);
  }
}

async function cleanupTestData(supabase, staffIds, serviceIds) {
  try {
    // Clean up in reverse dependency order
    await supabase.from('availability_slots').delete().in('staff_id', staffIds);
    await supabase.from('staff_schedules').delete().in('staff_id', staffIds);
    await supabase.from('staff_services').delete().in('staff_id', staffIds);
    await supabase.from('staff').delete().in('id', staffIds);
    await supabase.from('services').delete().in('id', serviceIds);
    
    // Clean up tenant (this will cascade delete related records)
    await supabase.from('tenants').delete().eq('slug', 'benchmark-test');
    
    console.log('  ✅ Test data cleaned up successfully');
  } catch (error) {
    console.error('  ❌ Cleanup error:', error);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📤 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📤 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the benchmark
main().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});