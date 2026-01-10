#!/usr/bin/env node

/**
 * Week 7: Load Testing Framework
 * Comprehensive load testing for production readiness validation
 */

import { createClient } from '@supabase/supabase-js';
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

/**
 * @typedef {Object} LoadTestConfig
 * @property {string} testName
 * @property {number} duration - seconds
 * @property {number} concurrency
 * @property {number} rampUpTime - seconds
 * @property {number} targetRPS - requests per second
 * @property {TestEndpoint[]} endpoints
 */

/**
 * @typedef {Object} TestEndpoint
 * @property {string} name
 * @property {'GET'|'POST'|'PUT'|'DELETE'} method
 * @property {string} path
 * @property {Record<string, string>} [headers]
 * @property {any} [body]
 * @property {number} weight - percentage of traffic
 */

/**
 * @typedef {Object} LoadTestResults
 * @property {string} testName
 * @property {number} duration
 * @property {number} totalRequests
 * @property {number} successfulRequests
 * @property {number} failedRequests
 * @property {number} averageResponseTime
 * @property {number} p95ResponseTime
 * @property {number} p99ResponseTime
 * @property {number} requestsPerSecond
 * @property {number} errorRate
 * @property {EndpointResults[]} endpoints
 * @property {ErrorSummary[]} errors
 */

/**
 * @typedef {Object} EndpointResults
 * @property {string} name
 * @property {number} requests
 * @property {number} successes
 * @property {number} failures
 * @property {number} avgResponseTime
 * @property {number} p95ResponseTime
 * @property {string[]} errors
 */

/**
 * @typedef {Object} ErrorSummary
 * @property {string} error
 * @property {number} count
 * @property {number} percentage
 */

class LoadTester {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    this.results = new Map();
    this.errors = new Map();
    this.activeRequests = 0;
    this.testStartTime = 0;
  }

  /**
   * @param {LoadTestConfig} config
   * @returns {Promise<LoadTestResults>}
   */
  async runLoadTest(config) {
    console.log(`🚀 Starting load test: ${config.testName}`);
    console.log(`Duration: ${config.duration}s, Concurrency: ${config.concurrency}, Target RPS: ${config.targetRPS}`);

    this.testStartTime = Date.now();
    const workers = [];

    // Start workers with ramp-up
    for (let i = 0; i < config.concurrency; i++) {
      const delay = (config.rampUpTime * 1000 * i) / config.concurrency;
      workers.push(this.startWorker(config, delay));
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    return this.generateResults(config);
  }

  /**
   * @param {LoadTestConfig} config
   * @param {number} startDelay
   * @returns {Promise<void>}
   */
  async startWorker(config, startDelay) {
    if (startDelay > 0) {
      await this.sleep(startDelay);
    }

    const endTime = this.testStartTime + (config.duration * 1000);
    const requestInterval = 1000 / (config.targetRPS / config.concurrency);

    while (Date.now() < endTime) {
      const endpoint = this.selectEndpoint(config.endpoints);
      await this.executeRequest(endpoint);
      
      // Maintain target RPS
      await this.sleep(requestInterval);
    }
  }

  /**
   * @param {TestEndpoint[]} endpoints
   * @returns {TestEndpoint}
   */
  selectEndpoint(endpoints) {
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const endpoint of endpoints) {
      cumulative += endpoint.weight;
      if (random <= cumulative) {
        return endpoint;
      }
    }

    return endpoints[endpoints.length - 1];
  }

  /**
   * @param {TestEndpoint} endpoint
   * @returns {Promise<void>}
   */
  async executeRequest(endpoint) {
    const startTime = performance.now();
    this.activeRequests++;

    try {
      const response = await this.makeRequest(endpoint);
      const responseTime = performance.now() - startTime;

      if (!this.results.has(endpoint.name)) {
        this.results.set(endpoint.name, []);
      }

      this.results.get(endpoint.name)!.push(responseTime);

      if (!response.ok) {
        this.recordError(`${endpoint.name}: HTTP ${response.status}`);
      }

    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.results.get(endpoint.name)?.push(responseTime) || this.results.set(endpoint.name, [responseTime]);
      this.recordError(`${endpoint.name}: ${error.message || error.toString()}`);
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * @param {TestEndpoint} endpoint
   * @returns {Promise<Response>}
   */
  async makeRequest(endpoint) {
    const url = `http://localhost:3000${endpoint.path}`;
    
    const options = {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'test-tenant-id',
        ...endpoint.headers,
      },
    };

    if (endpoint.body && (endpoint.method === 'POST' || endpoint.method === 'PUT')) {
      options.body = JSON.stringify(endpoint.body);
    }

    return fetch(url, options);
  }

  /**
   * @param {string} error
   */
  recordError(error) {
    this.errors.set(error, (this.errors.get(error) || 0) + 1);
  }

  /**
   * @param {LoadTestConfig} config
   * @returns {LoadTestResults}
   */
  generateResults(config) {
    const endpointResults: EndpointResults[] = [];
    let totalRequests = 0;
    let totalResponseTime = 0;
    let allResponseTimes: number[] = [];

    for (const endpoint of config.endpoints) {
      const times = this.results.get(endpoint.name) || [];
      const successes = times.length - this.getEndpointErrors(endpoint.name);
      const failures = this.getEndpointErrors(endpoint.name);

      endpointResults.push({
        name: endpoint.name,
        requests: times.length,
        successes,
        failures,
        avgResponseTime: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
        p95ResponseTime: this.calculatePercentile(times, 95),
        errors: this.getEndpointErrorMessages(endpoint.name),
      });

      totalRequests += times.length;
      totalResponseTime += times.reduce((a, b) => a + b, 0);
      allResponseTimes = allResponseTimes.concat(times);
    }

    const failedRequests = Array.from(this.errors.values()).reduce((a, b) => a + b, 0);
    const successfulRequests = totalRequests - failedRequests;

    return {
      testName: config.testName,
      duration: config.duration,
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
      p95ResponseTime: this.calculatePercentile(allResponseTimes, 95),
      p99ResponseTime: this.calculatePercentile(allResponseTimes, 99),
      requestsPerSecond: totalRequests / config.duration,
      errorRate: totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
      endpoints: endpointResults,
      errors: this.generateErrorSummary(totalRequests),
    };
  }

  /**
   * @param {number[]} values
   * @param {number} percentile
   * @returns {number}
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * @param {string} endpointName
   * @returns {number}
   */
  getEndpointErrors(endpointName) {
    return Array.from(this.errors.entries())
      .filter(([error]) => error.startsWith(endpointName))
      .reduce((sum, [, count]) => sum + count, 0);
  }

  /**
   * @param {string} endpointName
   * @returns {string[]}
   */
  getEndpointErrorMessages(endpointName) {
    return Array.from(this.errors.keys())
      .filter(error => error.startsWith(endpointName));
  }

  /**
   * @param {number} totalRequests
   * @returns {ErrorSummary[]}
   */
  generateErrorSummary(totalRequests) {
    return Array.from(this.errors.entries()).map(([error, count]) => ({
      error,
      count,
      percentage: totalRequests > 0 ? (count / totalRequests) * 100 : 0,
    }));
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Load Test Configurations
const loadTestConfigs = [
  {
    testName: 'Core API Baseline',
    duration: 120, // 2 minutes
    concurrency: 10,
    rampUpTime: 30,
    targetRPS: 50,
    endpoints: [
      {
        name: 'analytics-dashboard',
        method: 'GET',
        path: '/api/analytics/dashboard?period=week',
        weight: 25,
      },
      {
        name: 'booking-trends',
        method: 'GET',
        path: '/api/analytics/trends?days=7',
        weight: 20,
      },
      {
        name: 'ml-scheduling',
        method: 'GET',
        path: '/api/ml/predictions?type=scheduling',
        weight: 15,
      },
      {
        name: 'staff-performance',
        method: 'GET',
        path: '/api/analytics/staff?period=week',
        weight: 15,
      },
      {
        name: 'modules-list',
        method: 'GET',
        path: '/api/modules',
        weight: 15,
      },
      {
        name: 'anomaly-detection',
        method: 'GET',
        path: '/api/ml/predictions?type=anomalies',
        weight: 10,
      },
    ],
  },
  {
    testName: 'High Concurrency Stress Test',
    duration: 300, // 5 minutes
    concurrency: 50,
    rampUpTime: 60,
    targetRPS: 200,
    endpoints: [
      {
        name: 'analytics-dashboard',
        method: 'GET',
        path: '/api/analytics/dashboard?period=day',
        weight: 40,
      },
      {
        name: 'ml-predictions',
        method: 'GET',
        path: '/api/ml/predictions?type=demand',
        weight: 30,
      },
      {
        name: 'security-scan',
        method: 'GET',
        path: '/api/security/evaluate',
        weight: 20,
      },
      {
        name: 'jobs-status',
        method: 'GET',
        path: '/api/jobs',
        weight: 10,
      },
    ],
  },
  {
    testName: 'Database Intensive Load',
    duration: 180, // 3 minutes
    concurrency: 25,
    rampUpTime: 45,
    targetRPS: 100,
    endpoints: [
      {
        name: 'analytics-trends',
        method: 'GET',
        path: '/api/analytics/trends?days=30',
        weight: 35,
      },
      {
        name: 'vertical-analytics',
        method: 'GET',
        path: '/api/analytics/vertical?vertical=beauty',
        weight: 25,
      },
      {
        name: 'customer-insights',
        method: 'GET',
        path: '/api/ml/predictions?type=insights',
        weight: 20,
      },
      {
        name: 'pricing-optimization',
        method: 'GET',
        path: '/api/ml/predictions?type=pricing',
        weight: 20,
      },
    ],
  },
  {
    testName: 'Write Operations Load',
    duration: 240, // 4 minutes
    concurrency: 20,
    rampUpTime: 60,
    targetRPS: 75,
    endpoints: [
      {
        name: 'module-install',
        method: 'POST',
        path: '/api/modules',
        body: { action: 'install', moduleId: 'beauty-salon' },
        weight: 30,
      },
      {
        name: 'security-evaluation',
        method: 'POST',
        path: '/api/security/evaluate',
        body: { scanType: 'full', priority: 'medium' },
        weight: 25,
      },
      {
        name: 'job-creation',
        method: 'POST',
        path: '/api/jobs',
        body: { type: 'analytics_refresh', priority: 'low' },
        weight: 25,
      },
      {
        name: 'module-configure',
        method: 'POST',
        path: '/api/modules',
        body: { action: 'configure', moduleId: 'beauty-salon', configuration: {} },
        weight: 20,
      },
    ],
  },
];

// Performance Thresholds
const PERFORMANCE_THRESHOLDS = {
  maxAverageResponseTime: 500, // ms
  maxP95ResponseTime: 1000, // ms
  maxP99ResponseTime: 2000, // ms
  maxErrorRate: 1, // percentage
  minRequestsPerSecond: 30,
};

async function runAllLoadTests() {
  console.log('🏋️ Week 7: Production Load Testing Suite');
  console.log('=========================================\n');

  const allResults = [];

  for (const config of loadTestConfigs) {
    const tester = new LoadTester();
    
    console.log(`\n📊 Running: ${config.testName}`);
    console.log('─'.repeat(50));

    try {
      const results = await tester.runLoadTest(config);
      allResults.push(results);
      printResults(results);
      
      // Wait between tests
      console.log('\n⏳ Waiting 30s before next test...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
    } catch (error) {
      console.error(`❌ Test failed: ${error.message || error.toString()}`);
    }
  }

  // Generate comprehensive report
  generateComprehensiveReport(allResults);
}

function printResults(results) {
  console.log(`\n📈 Results for ${results.testName}:`);
  console.log(`  Duration: ${results.duration}s`);
  console.log(`  Total Requests: ${results.totalRequests}`);
  console.log(`  Successful: ${results.successfulRequests} (${(100 - results.errorRate).toFixed(1)}%)`);
  console.log(`  Failed: ${results.failedRequests} (${results.errorRate.toFixed(1)}%)`);
  console.log(`  Requests/sec: ${results.requestsPerSecond.toFixed(1)}`);
  console.log(`  Avg Response Time: ${results.averageResponseTime.toFixed(0)}ms`);
  console.log(`  P95 Response Time: ${results.p95ResponseTime.toFixed(0)}ms`);
  console.log(`  P99 Response Time: ${results.p99ResponseTime.toFixed(0)}ms`);

  // Performance assessment
  const passed = assessPerformance(results);
  console.log(`\n${passed ? '✅' : '❌'} Performance Assessment: ${passed ? 'PASSED' : 'FAILED'}`);

  if (results.errors.length > 0) {
    console.log('\n🚨 Errors:');
    results.errors.slice(0, 5).forEach(error => {
      console.log(`  ${error.error}: ${error.count} (${error.percentage.toFixed(1)}%)`);
    });
  }
}

function assessPerformance(results) {
  const checks = [
    results.averageResponseTime <= PERFORMANCE_THRESHOLDS.maxAverageResponseTime,
    results.p95ResponseTime <= PERFORMANCE_THRESHOLDS.maxP95ResponseTime,
    results.p99ResponseTime <= PERFORMANCE_THRESHOLDS.maxP99ResponseTime,
    results.errorRate <= PERFORMANCE_THRESHOLDS.maxErrorRate,
    results.requestsPerSecond >= PERFORMANCE_THRESHOLDS.minRequestsPerSecond,
  ];

  return checks.every(check => check);
}

function generateComprehensiveReport(allResults) {
  console.log('\n📋 COMPREHENSIVE LOAD TEST REPORT');
  console.log('==================================');

  const totalTests = allResults.length;
  const passedTests = allResults.filter(assessPerformance).length;
  const overallSuccess = (passedTests / totalTests) * 100;

  console.log(`\n🎯 Overall Performance Score: ${overallSuccess.toFixed(1)}% (${passedTests}/${totalTests} tests passed)`);

  // Aggregate statistics
  const totalRequests = allResults.reduce((sum, r) => sum + r.totalRequests, 0);
  const avgResponseTime = allResults.reduce((sum, r) => sum + r.averageResponseTime, 0) / allResults.length;
  const maxP99 = Math.max(...allResults.map(r => r.p99ResponseTime));
  const avgErrorRate = allResults.reduce((sum, r) => sum + r.errorRate, 0) / allResults.length;

  console.log(`\n📊 Aggregate Statistics:`);
  console.log(`  Total Requests Processed: ${totalRequests.toLocaleString()}`);
  console.log(`  Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
  console.log(`  Maximum P99 Response Time: ${maxP99.toFixed(0)}ms`);
  console.log(`  Average Error Rate: ${avgErrorRate.toFixed(2)}%`);

  // Performance grade
  let grade = 'F';
  if (overallSuccess >= 90) grade = 'A';
  else if (overallSuccess >= 80) grade = 'B';
  else if (overallSuccess >= 70) grade = 'C';
  else if (overallSuccess >= 60) grade = 'D';

  console.log(`\n🏆 Performance Grade: ${grade}`);

  // Recommendations
  console.log(`\n💡 Recommendations:`);
  if (avgResponseTime > PERFORMANCE_THRESHOLDS.maxAverageResponseTime) {
    console.log('  - Optimize database queries and add caching');
  }
  if (maxP99 > PERFORMANCE_THRESHOLDS.maxP99ResponseTime) {
    console.log('  - Review slowest endpoints for optimization');
  }
  if (avgErrorRate > PERFORMANCE_THRESHOLDS.maxErrorRate) {
    console.log('  - Investigate and fix error-prone endpoints');
  }
  if (grade !== 'A') {
    console.log('  - Consider scaling infrastructure');
    console.log('  - Implement connection pooling');
    console.log('  - Add CDN for static assets');
  }

  console.log(`\n✅ Load testing completed. System ${overallSuccess >= 80 ? 'READY' : 'NEEDS OPTIMIZATION'} for production.`);
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllLoadTests().catch(console.error);
}