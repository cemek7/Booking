/**
 * Week 7: Simplified Load Testing Framework
 * Performance validation for production readiness
 */

import { performance } from 'perf_hooks';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

async function testEndpoint(endpoint, options = {}) {
  const start = performance.now();
  
  try {
    const response = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'GET',
      headers: {
        'x-tenant-id': 'test-tenant-id',
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: 5000,
    });
    
    const responseTime = performance.now() - start;
    
    return {
      success: response.ok,
      responseTime,
      status: response.status,
      endpoint
    };
  } catch (error) {
    const responseTime = performance.now() - start;
    return {
      success: false,
      responseTime,
      status: 0,
      endpoint,
      error: error.message
    };
  }
}

async function runLoadTest(testConfig) {
  console.log(`🧪 Running ${testConfig.name}`);
  console.log(`   ${testConfig.description}`);
  
  const results = {
    testName: testConfig.name,
    success: false,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgResponseTime: 0,
    maxResponseTime: 0,
    minResponseTime: Infinity,
    responseTimes: [],
    errors: []
  };

  const startTime = Date.now();
  const endTime = startTime + (testConfig.duration * 1000);
  const requestInterval = 1000 / testConfig.requestsPerSecond;

  while (Date.now() < endTime) {
    const requests = testConfig.endpoints.map(endpoint => 
      testEndpoint(endpoint)
    );
    
    const batchResults = await Promise.all(requests);
    
    for (const result of batchResults) {
      results.totalRequests++;
      results.responseTimes.push(result.responseTime);
      
      if (result.success) {
        results.successfulRequests++;
      } else {
        results.failedRequests++;
        results.errors.push(`${result.endpoint}: ${result.error || result.status}`);
      }
      
      results.maxResponseTime = Math.max(results.maxResponseTime, result.responseTime);
      results.minResponseTime = Math.min(results.minResponseTime, result.responseTime);
    }
    
    // Wait for next request cycle
    await new Promise(resolve => setTimeout(resolve, requestInterval));
  }

  // Calculate metrics
  results.avgResponseTime = results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length;
  results.errorRate = (results.failedRequests / results.totalRequests) * 100;
  
  // Sort response times for percentiles
  const sortedTimes = results.responseTimes.sort((a, b) => a - b);
  results.p50ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
  results.p95ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
  results.p99ResponseTime = sortedTimes[Math.floor(sortedTimes.length * 0.99)];

  // Performance assessment
  results.success = results.avgResponseTime < 500 && 
                   results.p95ResponseTime < 1000 && 
                   results.errorRate < 1;

  return results;
}

function gradePerformance(results) {
  let score = 100;
  
  // Response time penalties
  if (results.avgResponseTime > 1000) score -= 30;
  else if (results.avgResponseTime > 500) score -= 15;
  else if (results.avgResponseTime > 200) score -= 5;
  
  if (results.p95ResponseTime > 2000) score -= 25;
  else if (results.p95ResponseTime > 1000) score -= 10;
  
  // Error rate penalties
  if (results.errorRate > 5) score -= 40;
  else if (results.errorRate > 1) score -= 20;
  else if (results.errorRate > 0.1) score -= 5;
  
  // Grade assignment
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

async function runAllLoadTests() {
  console.log('⚡ Week 7: Load Testing Suite');
  console.log('=============================\n');

  const testConfigs = [
    {
      name: 'Baseline Performance',
      description: 'Normal load conditions',
      duration: 30, // Reduced for faster testing
      requestsPerSecond: 10,
      endpoints: [
        '/api/analytics/dashboard',
        '/api/modules'
      ]
    },
    {
      name: 'Stress Test',
      description: 'High load testing',
      duration: 45,
      requestsPerSecond: 25,
      endpoints: [
        '/api/analytics/dashboard',
        '/api/analytics/trends?days=7',
        '/api/ml/predictions?type=scheduling'
      ]
    },
    {
      name: 'Database Load',
      description: 'Database-intensive operations',
      duration: 60,
      requestsPerSecond: 15,
      endpoints: [
        '/api/analytics/trends?days=30',
        '/api/analytics/staff'
      ]
    }
  ];

  const allResults = [];
  
  for (const config of testConfigs) {
    console.log(`\n🧪 Test ${allResults.length + 1}/${testConfigs.length}`);
    console.log('─'.repeat(50));
    
    try {
      const result = await runLoadTest(config);
      allResults.push(result);
      
      console.log(`   📊 Results:`);
      console.log(`     Total Requests: ${result.totalRequests}`);
      console.log(`     Success Rate: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(1)}%`);
      console.log(`     Avg Response: ${result.avgResponseTime.toFixed(0)}ms`);
      console.log(`     P95 Response: ${result.p95ResponseTime.toFixed(0)}ms`);
      console.log(`     Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
      
      // Wait between tests
      if (allResults.length < testConfigs.length) {
        console.log('\n⏳ Recovery period (10s)...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
    } catch (error) {
      console.error(`   ❌ Test failed: ${error.message}`);
      allResults.push({
        testName: config.name,
        success: false,
        error: error.message
      });
    }
  }

  // Generate summary report
  console.log('\n📈 LOAD TESTING SUMMARY');
  console.log('========================');

  const passedTests = allResults.filter(r => r.success).length;
  const totalTests = allResults.length;
  const overallScore = (passedTests / totalTests) * 100;

  console.log(`\n🎯 Tests Passed: ${passedTests}/${totalTests} (${overallScore.toFixed(0)}%)`);

  // Calculate aggregate metrics
  const validResults = allResults.filter(r => r.success && r.avgResponseTime);
  if (validResults.length > 0) {
    const avgResponseTime = validResults.reduce((sum, r) => sum + r.avgResponseTime, 0) / validResults.length;
    const maxP95 = Math.max(...validResults.map(r => r.p95ResponseTime));
    const avgErrorRate = validResults.reduce((sum, r) => sum + (r.errorRate || 0), 0) / validResults.length;

    console.log(`\n📊 Aggregate Metrics:`);
    console.log(`   Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
    console.log(`   Maximum P95 Response: ${maxP95.toFixed(0)}ms`);
    console.log(`   Average Error Rate: ${avgErrorRate.toFixed(2)}%`);

    const overallGrade = gradePerformance({
      avgResponseTime,
      p95ResponseTime: maxP95,
      errorRate: avgErrorRate
    });

    console.log(`\n🏆 Overall Grade: ${overallGrade}`);

    // Recommendations
    console.log(`\n💡 Recommendations:`);
    if (avgResponseTime > 500) {
      console.log('  - Optimize slow endpoints and database queries');
    }
    if (maxP95 > 1000) {
      console.log('  - Implement caching for frequently accessed data');
    }
    if (avgErrorRate > 0.5) {
      console.log('  - Improve error handling and system stability');
    }
    if (overallScore < 80) {
      console.log('  - Address performance bottlenecks before production');
    }

    console.log(`\n${overallScore >= 80 ? '✅' : '⚠️'} System ${overallScore >= 80 ? 'READY' : 'NEEDS IMPROVEMENT'} for production load.`);
  }

  return allResults;
}

// Export for other scripts
export { runAllLoadTests, testEndpoint };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllLoadTests().catch(console.error);
}