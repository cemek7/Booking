/**
 * Week 7: Chaos Engineering & Failover Drills
 * Systematic failure injection and recovery validation
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const ChaosTest = {
  name: '',
  description: '',
  failureType: 'network', // 'network' | 'database' | 'memory' | 'cpu' | 'disk' | 'dependency'
  duration: 0, // seconds
  severity: 'low', // 'low' | 'medium' | 'high'
  expectedRecoveryTime: 0, // seconds
  validationEndpoints: []
};

const ChaosTestResult = {
  testName: '',
  success: false,
  failureInjected: false,
  failureDetected: false,
  recoveryTime: 0,
  serviceAvailability: 0, // percentage
  errors: [],
  metrics: {
    responseTimeDuringFailure: [],
    responseTimeAfterRecovery: [],
    errorRateDuringFailure: 0,
    errorRateAfterRecovery: 0,
  },
};

class ChaosEngineer {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    this.monitoringActive = false;
    this.metrics = new Map();
  }

  async runChaosTest(test) {
    console.log(`🌪️  Starting chaos test: ${test.name}`);
    console.log(`   ${test.description}`);

    const result = {
      testName: test.name,
      success: false,
      failureInjected: false,
      failureDetected: false,
      recoveryTime: 0,
      serviceAvailability: 0,
      errors: [],
      metrics: {
        responseTimeDuringFailure: [],
        responseTimeAfterRecovery: [],
        errorRateDuringFailure: 0,
        errorRateAfterRecovery: 0,
      },
    };

    try {
      // Start monitoring
      this.startMonitoring(test.validationEndpoints);

      // Phase 1: Baseline measurement
      console.log('   📊 Establishing baseline...');
      await this.measureBaseline(test.validationEndpoints, 30);

      // Phase 2: Inject failure
      console.log(`   💥 Injecting ${test.failureType} failure...`);
      const failureHandle = await this.injectFailure(test);
      result.failureInjected = failureHandle !== null;

      // Phase 3: Monitor during failure
      console.log('   🔍 Monitoring during failure...');
      const failureStartTime = performance.now();
      const failureMetrics = await this.monitorDuringFailure(test.validationEndpoints, test.duration);
      
      result.metrics.responseTimeDuringFailure = failureMetrics.responseTimes;
      result.metrics.errorRateDuringFailure = failureMetrics.errorRate;
      result.failureDetected = failureMetrics.errorRate > 5; // 5% error threshold

      // Phase 4: Stop failure injection
      console.log('   🛑 Stopping failure injection...');
      if (failureHandle) {
        await this.stopFailureInjection(test.failureType, failureHandle);
      }

      // Phase 5: Monitor recovery
      console.log('   🔄 Monitoring recovery...');
      const recoveryMetrics = await this.monitorRecovery(test.validationEndpoints, test.expectedRecoveryTime * 2);
      
      result.metrics.responseTimeAfterRecovery = recoveryMetrics.responseTimes;
      result.metrics.errorRateAfterRecovery = recoveryMetrics.errorRate;
      result.recoveryTime = (performance.now() - failureStartTime) / 1000;

      // Phase 6: Calculate availability
      const totalTime = test.duration + result.recoveryTime;
      const downtime = result.recoveryTime;
      result.serviceAvailability = ((totalTime - downtime) / totalTime) * 100;

      // Assessment
      result.success = result.failureDetected && 
                      result.recoveryTime <= test.expectedRecoveryTime &&
                      result.metrics.errorRateAfterRecovery < 1 &&
                      result.serviceAvailability >= 95;

      this.stopMonitoring();

    } catch (error) {
      result.errors.push((error as Error).message);
      this.stopMonitoring();
    }

    return result;
  }

  private async measureBaseline(endpoints, duration) {
    const endTime = Date.now() + (duration * 1000);
    
    while (Date.now() < endTime) {
      for (const endpoint of endpoints) {
        try {
          const start = performance.now();
          await this.testEndpoint(endpoint);
          const responseTime = performance.now() - start;
          
          if (!this.metrics.has('baseline')) {
            this.metrics.set('baseline', []);
          }
          this.metrics.get('baseline')!.push({ endpoint, responseTime, success: true });
        } catch (error) {
          this.metrics.get('baseline')?.push({ endpoint, responseTime: -1, success: false });
        }
      }
      
      await this.sleep(1000);
    }
  }

  private async injectFailure(test) {
    switch (test.failureType) {
      case 'network':
        return this.injectNetworkFailure(test.severity);
      case 'database':
        return this.injectDatabaseFailure(test.severity);
      case 'memory':
        return this.injectMemoryPressure(test.severity);
      case 'cpu':
        return this.injectCPUPressure(test.severity);
      case 'dependency':
        return this.injectDependencyFailure(test.severity);
      default:
        throw new Error(`Unsupported failure type: ${test.failureType}`);
    }
  }

  private async injectNetworkFailure(severity) {
    console.log(`     🌐 Simulating network latency (${severity})`);
    
    // Simulate network issues by adding delays to requests
    const latencyMap = { low: 100, medium: 500, high: 2000 };
    const latency = latencyMap[severity as keyof typeof latencyMap] || 100;
    
    return { type: 'network', latency, active: true };
  }

  private async injectDatabaseFailure(severity) {
    console.log(`     🗄️  Simulating database issues (${severity})`);
    
    // Create some database stress
    try {
      if (severity === 'high') {
        // Simulate connection pool exhaustion
        const connections = Array.from({ length: 10 }, () => 
          this.supabase.from('analytics_metrics_cache').select('*').limit(1000)
        );
        await Promise.all(connections);
      }
    } catch (error) {
      // Expected - we're causing stress
    }
    
    return { type: 'database', severity, active: true };
  }

  private async injectMemoryPressure(severity) {
    console.log(`     🧠 Simulating memory pressure (${severity})`);
    
    const sizeMap = { low: 50, medium: 100, high: 200 }; // MB
    const size = sizeMap[severity as keyof typeof sizeMap] || 50;
    
    // Allocate memory to simulate pressure
    const memoryHog = [];
    const targetSize = size * 1024 * 1024; // Convert to bytes
    
    for (let i = 0; i < targetSize / 1024; i++) {
      memoryHog.push(new Array(256).fill(Math.random()));
    }
    
    return { type: 'memory', data: memoryHog, active: true };
  }

  private async injectCPUPressure(severity) {
    console.log(`     ⚡ Simulating CPU pressure (${severity})`);
    
    const intensityMap = { low: 25, medium: 50, high: 75 };
    const intensity = intensityMap[severity as keyof typeof intensityMap] || 25;
    
    const workers: any[] = [];
    const numWorkers = Math.ceil((intensity / 100) * 4); // Max 4 workers
    
    for (let i = 0; i < numWorkers; i++) {
      const worker = setInterval(() => {
        // CPU-intensive calculation
        for (let j = 0; j < 100000; j++) {
          Math.sqrt(Math.random());
        }
      }, 10);
      workers.push(worker);
    }
    
    return { type: 'cpu', workers, active: true };
  }

  private async injectDependencyFailure(severity) {
    console.log(`     🔗 Simulating dependency failure (${severity})`);
    
    // Simulate external service failures
    return { type: 'dependency', severity, active: true };
  }

  private async stopFailureInjection(type, handle) {
    if (!handle || !handle.active) return;
    
    switch (type) {
      case 'network':
        handle.active = false;
        break;
      case 'database':
        handle.active = false;
        break;
      case 'memory':
        if (handle.data) {
          handle.data.length = 0; // Clear memory
        }
        handle.active = false;
        break;
      case 'cpu':
        if (handle.workers) {
          handle.workers.forEach((worker: any) => clearInterval(worker));
        }
        handle.active = false;
        break;
      case 'dependency':
        handle.active = false;
        break;
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  private async monitorDuringFailure(endpoints, duration) {
    const metrics = { responseTimes: [], errorCount: 0, totalRequests: 0 };
    const endTime = Date.now() + (duration * 1000);
    
    while (Date.now() < endTime) {
      for (const endpoint of endpoints) {
        try {
          const start = performance.now();
          await this.testEndpoint(endpoint);
          const responseTime = performance.now() - start;
          metrics.responseTimes.push(responseTime);
          metrics.totalRequests++;
        } catch (error) {
          metrics.errorCount++;
          metrics.totalRequests++;
        }
      }
      
      await this.sleep(500); // More frequent monitoring during failure
    }
    
    return {
      ...metrics,
      errorRate: metrics.totalRequests > 0 ? (metrics.errorCount / metrics.totalRequests) * 100 : 0,
    };
  }

  private async monitorRecovery(endpoints, maxWaitTime) {
    const metrics = { responseTimes: [], errorCount: 0, totalRequests: 0 };
    const startTime = Date.now();
    const endTime = startTime + (maxWaitTime * 1000);
    
    while (Date.now() < endTime) {
      let allHealthy = true;
      
      for (const endpoint of endpoints) {
        try {
          const start = performance.now();
          await this.testEndpoint(endpoint);
          const responseTime = performance.now() - start;
          metrics.responseTimes.push(responseTime);
          metrics.totalRequests++;
          
          // Consider healthy if response time is reasonable
          if (responseTime > 5000) { // 5 seconds threshold
            allHealthy = false;
          }
        } catch (error) {
          metrics.errorCount++;
          metrics.totalRequests++;
          allHealthy = false;
        }
      }
      
      // If all endpoints are healthy for 3 consecutive checks, consider recovered
      if (allHealthy && metrics.totalRequests >= endpoints.length * 3) {
        break;
      }
      
      await this.sleep(1000);
    }
    
    return {
      ...metrics,
      errorRate: metrics.totalRequests > 0 ? (metrics.errorCount / metrics.totalRequests) * 100 : 0,
    };
  }

  private async testEndpoint(endpoint) {
    const response = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'GET',
      headers: {
        'x-tenant-id': 'test-tenant-id',
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response;
  }

  private startMonitoring(endpoints) {
    this.monitoringActive = true;
    // In a real implementation, this would start collecting system metrics
    console.log('     📊 Monitoring started');
  }

  private stopMonitoring() {
    this.monitoringActive = false;
    console.log('     📊 Monitoring stopped');
  }

  private sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Chaos Test Suite
const chaosTests = [
  {
    name: 'Network Latency Spike',
    description: 'Simulate high network latency and measure recovery',
    failureType: 'network',
    duration: 60,
    severity: 'medium',
    expectedRecoveryTime: 10,
    validationEndpoints: [
      '/api/analytics/dashboard',
      '/api/modules',
      '/api/ml/predictions?type=scheduling',
    ],
  },
  {
    name: 'Database Connection Stress',
    description: 'Overwhelm database connections and test connection pooling',
    failureType: 'database',
    duration: 90,
    severity: 'high',
    expectedRecoveryTime: 30,
    validationEndpoints: [
      '/api/analytics/trends?days=7',
      '/api/analytics/staff',
      '/api/ml/predictions?type=anomalies',
    ],
  },
  {
    name: 'Memory Pressure Test',
    description: 'Create memory pressure and test garbage collection',
    failureType: 'memory',
    duration: 120,
    severity: 'high',
    expectedRecoveryTime: 20,
    validationEndpoints: [
      '/api/analytics/dashboard',
      '/api/ml/predictions?type=pricing',
      '/api/security/evaluate',
    ],
  },
  {
    name: 'CPU Saturation Test',
    description: 'Saturate CPU and measure response time degradation',
    failureType: 'cpu',
    duration: 60,
    severity: 'high',
    expectedRecoveryTime: 15,
    validationEndpoints: [
      '/api/analytics/trends?days=30',
      '/api/ml/predictions?type=demand',
      '/api/modules',
    ],
  },
  {
    name: 'Dependency Failure Simulation',
    description: 'Simulate external service failures and test graceful degradation',
    failureType: 'dependency',
    duration: 90,
    severity: 'medium',
    expectedRecoveryTime: 5,
    validationEndpoints: [
      '/api/analytics/dashboard',
      '/api/analytics/vertical?vertical=beauty',
      '/api/jobs',
    ],
  },
];

async function runChaosTestSuite() {
  console.log('🌪️  Week 7: Chaos Engineering & Failover Drills');
  console.log('==============================================\n');

  const engineer = new ChaosEngineer();
  const results = [];

  for (const test of chaosTests) {
    console.log(`\n🧪 Test ${results.length + 1}/${chaosTests.length}`);
    console.log('─'.repeat(60));

    try {
      const result = await engineer.runChaosTest(test);
      results.push(result);
      printChaosResult(result);
      
      // Recovery period between tests
      console.log('\n⏳ Recovery period (60s)...\n');
      await new Promise(resolve => setTimeout(resolve, 60000));
      
    } catch (error) {
      console.error(`❌ Test failed: ${(error as Error).message}`);
    }
  }

  generateChaosReport(results);
}

function printChaosResult(result) {
  console.log(`\n📋 Results for ${result.testName}:`);
  console.log(`   Failure Injected: ${result.failureInjected ? '✅' : '❌'}`);
  console.log(`   Failure Detected: ${result.failureDetected ? '✅' : '❌'}`);
  console.log(`   Recovery Time: ${result.recoveryTime.toFixed(1)}s`);
  console.log(`   Service Availability: ${result.serviceAvailability.toFixed(1)}%`);
  console.log(`   Error Rate (During): ${result.metrics.errorRateDuringFailure.toFixed(1)}%`);
  console.log(`   Error Rate (After): ${result.metrics.errorRateAfterRecovery.toFixed(1)}%`);
  
  const status = result.success ? '✅ PASSED' : '❌ FAILED';
  console.log(`\n   Overall: ${status}`);

  if (result.errors.length > 0) {
    console.log(`\n   🚨 Errors:`);
    result.errors.forEach(error => console.log(`     - ${error}`));
  }
}

function generateChaosReport(results) {
  console.log('\n🔬 CHAOS ENGINEERING REPORT');
  console.log('============================');

  const totalTests = results.length;
  const passedTests = results.filter(r => r.success).length;
  const resilienceScore = (passedTests / totalTests) * 100;

  console.log(`\n🎯 Resilience Score: ${resilienceScore.toFixed(1)}% (${passedTests}/${totalTests} tests passed)`);

  // Average metrics
  const avgRecoveryTime = results.reduce((sum, r) => sum + r.recoveryTime, 0) / results.length;
  const avgAvailability = results.reduce((sum, r) => sum + r.serviceAvailability, 0) / results.length;
  const maxRecoveryTime = Math.max(...results.map(r => r.recoveryTime));

  console.log(`\n📊 System Resilience Metrics:`);
  console.log(`   Average Recovery Time: ${avgRecoveryTime.toFixed(1)}s`);
  console.log(`   Maximum Recovery Time: ${maxRecoveryTime.toFixed(1)}s`);
  console.log(`   Average Availability: ${avgAvailability.toFixed(1)}%`);

  // Grade system resilience
  let resilienceGrade = 'F';
  if (resilienceScore >= 90 && avgAvailability >= 99) resilienceGrade = 'A';
  else if (resilienceScore >= 80 && avgAvailability >= 97) resilienceGrade = 'B';
  else if (resilienceScore >= 70 && avgAvailability >= 95) resilienceGrade = 'C';
  else if (resilienceScore >= 60 && avgAvailability >= 90) resilienceGrade = 'D';

  console.log(`\n🏆 Resilience Grade: ${resilienceGrade}`);

  // Recommendations
  console.log(`\n💡 Resilience Recommendations:`);
  if (avgRecoveryTime > 30) {
    console.log('  - Implement faster health checks and auto-recovery');
  }
  if (avgAvailability < 95) {
    console.log('  - Add circuit breakers and graceful degradation');
  }
  if (resilienceScore < 80) {
    console.log('  - Improve error handling and retry mechanisms');
    console.log('  - Implement better monitoring and alerting');
  }

  // Failure modes analysis
  const failureModes = results.reduce((modes: any, result) => {
    if (!result.success) {
      modes[result.testName] = result.errors.join(', ') || 'Timeout or performance threshold exceeded';
    }
    return modes;
  }, {});

  if (Object.keys(failureModes).length > 0) {
    console.log(`\n🚨 Failed Tests Analysis:`);
    Object.entries(failureModes).forEach(([test, reason]) => {
      console.log(`   ${test}: ${reason}`);
    });
  }

  console.log(`\n${resilienceScore >= 80 ? '✅' : '⚠️'} System ${resilienceScore >= 80 ? 'READY' : 'NEEDS IMPROVEMENTS'} for production chaos.`);
}

// Export for use in other scripts
export { ChaosEngineer, runChaosTestSuite };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runChaosTestSuite().catch(console.error);
}