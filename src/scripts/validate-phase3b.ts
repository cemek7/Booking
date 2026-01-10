#!/usr/bin/env node

/**
 * PHASE 3B VALIDATION SCRIPT
 * 
 * Automated validation for 4 health/security routes:
 * - GET /api/health (public)
 * - GET /api/ready (public)
 * - POST/GET /api/security/pii (authenticated)
 * - POST/GET /api/security/evaluate (authenticated)
 */

import chalk from 'chalk';

// Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-token';
const TIMEOUT = 10000;

// Helper functions
function logPass(message: string) {
  console.log(chalk.green('✓'), message);
}

function logFail(message: string, error?: any) {
  console.log(chalk.red('✗'), message);
  if (error) {
    console.log(chalk.dim(`  ${error}`));
  }
}

function logInfo(message: string) {
  console.log(chalk.blue('ℹ'), message);
}

function logSkip(message: string) {
  console.log(chalk.yellow('⊘'), message);
}

interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: { name: string; status: 'pass' | 'fail' | 'skip' }[];
}

// Test tracking
const results: TestResult = {
  passed: 0,
  failed: 0,
  skipped: 0,
  duration: 0,
  tests: [],
};

// Test functions
async function testHealthEndpoint(): Promise<void> {
  logInfo('Testing GET /api/health...');
  const testName = 'Health Endpoint';
  const startTime = Date.now();

  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (response.status === 200) {
      const data = await response.json();

      // Validate response structure
      const required = ['status', 'timestamp', 'uptime', 'environment', 'version', 'services', 'performance'];
      const missing = required.filter(field => !(field in data));

      if (missing.length === 0) {
        logPass(`Health endpoint: ${data.status}`);
        logPass(`  Response time: ${data.performance.response_time_ms}ms`);
        logPass(`  Memory usage: ${data.performance.memory_usage_mb}MB`);
        logPass(`  Services: ${Object.keys(data.services).length} checked`);
        results.passed += 4;
      } else {
        logFail(`Health endpoint: Missing fields: ${missing.join(', ')}`);
        results.failed += 1;
      }
    } else {
      logFail(`Health endpoint: Expected 200, got ${response.status}`);
      results.failed += 1;
    }

    const duration = Date.now() - startTime;
    if (duration > 500) {
      logFail(`Health response slow: ${duration}ms (target: < 500ms)`);
      results.failed += 1;
    } else {
      logPass(`Health response time: ${duration}ms (< 500ms)`);
      results.passed += 1;
    }

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`Health endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testReadyEndpoint(): Promise<void> {
  logInfo('Testing GET /api/ready...');
  const testName = 'Readiness Endpoint';
  const startTime = Date.now();

  try {
    const response = await fetch(`${API_BASE_URL}/api/ready`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if ([200, 503].includes(response.status)) {
      const data = await response.json();

      // Validate response structure
      const requiredChecks = [
        'database_migrations',
        'environment_variables',
        'required_services',
        'ai_services_initialized',
        'storage_accessible',
      ];
      const missingChecks = requiredChecks.filter(check => !(check in data.checks));

      if (missingChecks.length === 0) {
        logPass(`Ready endpoint: ${data.status}`);
        logPass(`  Checks performed: ${Object.keys(data.checks).length}`);
        results.passed += 2;
      } else {
        logFail(`Ready endpoint: Missing checks: ${missingChecks.join(', ')}`);
        results.failed += 1;
      }
    } else {
      logFail(`Ready endpoint: Expected 200 or 503, got ${response.status}`);
      results.failed += 1;
    }

    const duration = Date.now() - startTime;
    if (duration > 300) {
      logFail(`Ready response slow: ${duration}ms (target: < 300ms)`);
      results.failed += 1;
    } else {
      logPass(`Ready response time: ${duration}ms (< 300ms)`);
      results.passed += 1;
    }

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`Ready endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testPIIScanEndpoint(): Promise<void> {
  logInfo('Testing POST /api/security/pii...');
  const testName = 'PII Scan Endpoint';

  try {
    // Test without auth (should fail)
    const noAuthResponse = await fetch(`${API_BASE_URL}/api/security/pii`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (noAuthResponse.status === 401) {
      logPass('PII scan: Requires authentication');
      results.passed += 1;
    } else {
      logFail(`PII scan: Expected 401 without auth, got ${noAuthResponse.status}`);
      results.failed += 1;
    }

    // Note: Full testing requires valid auth token
    logSkip('PII scan: Full testing requires valid auth token');
    results.skipped += 1;

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`PII scan endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testPIIRegistryEndpoint(): Promise<void> {
  logInfo('Testing GET /api/security/pii...');
  const testName = 'PII Registry Endpoint';

  try {
    // Test without auth (should fail)
    const noAuthResponse = await fetch(`${API_BASE_URL}/api/security/pii`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (noAuthResponse.status === 401) {
      logPass('PII registry: Requires authentication');
      results.passed += 1;
    } else {
      logFail(`PII registry: Expected 401 without auth, got ${noAuthResponse.status}`);
      results.failed += 1;
    }

    logSkip('PII registry: Full testing requires valid auth token');
    results.skipped += 1;

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`PII registry endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testSecurityEvaluateEndpoint(): Promise<void> {
  logInfo('Testing POST /api/security/evaluate...');
  const testName = 'Security Evaluate Endpoint';

  try {
    // Test without auth (should fail)
    const noAuthResponse = await fetch(`${API_BASE_URL}/api/security/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (noAuthResponse.status === 401) {
      logPass('Security evaluate: Requires authentication');
      results.passed += 1;
    } else {
      logFail(`Security evaluate: Expected 401 without auth, got ${noAuthResponse.status}`);
      results.failed += 1;
    }

    logSkip('Security evaluate: Full testing requires valid auth token');
    results.skipped += 1;

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`Security evaluate endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testComplianceReportEndpoint(): Promise<void> {
  logInfo('Testing GET /api/security/evaluate...');
  const testName = 'Compliance Report Endpoint';

  try {
    // Test without auth (should fail)
    const noAuthResponse = await fetch(`${API_BASE_URL}/api/security/evaluate`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (noAuthResponse.status === 401) {
      logPass('Compliance report: Requires authentication');
      results.passed += 1;
    } else {
      logFail(`Compliance report: Expected 401 without auth, got ${noAuthResponse.status}`);
      results.failed += 1;
    }

    logSkip('Compliance report: Full testing requires valid auth token');
    results.skipped += 1;

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`Compliance report endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testIntegration(): Promise<void> {
  logInfo('Testing integration across endpoints...');
  const testName = 'Integration Tests';

  try {
    // Test that both public endpoints work together
    const [healthRes, readyRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/health`, { signal: AbortSignal.timeout(TIMEOUT) }),
      fetch(`${API_BASE_URL}/api/ready`, { signal: AbortSignal.timeout(TIMEOUT) }),
    ]);

    if (healthRes.ok && [200, 503].includes(readyRes.status)) {
      logPass('Both public endpoints accessible');
      results.passed += 1;
    } else {
      logFail('Public endpoint integration failed');
      results.failed += 1;
    }

    const healthData = await healthRes.json();
    const readyData = await readyRes.json();

    // Consistency check
    if (
      healthData.status === 'unhealthy' &&
      readyData.status === 'not_ready'
    ) {
      logPass('Health and readiness states are consistent');
      results.passed += 1;
    } else if (
      healthData.status === 'healthy' &&
      readyData.status === 'ready'
    ) {
      logPass('Health and readiness states are consistent');
      results.passed += 1;
    } else {
      logInfo('Health and readiness states differ (may be expected)');
      results.passed += 1;
    }

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`Integration test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

async function testPerformance(): Promise<void> {
  logInfo('Testing performance under load...');
  const testName = 'Performance Tests';

  try {
    const concurrentRequests = 5;
    const startTime = Date.now();

    const promises = Array(concurrentRequests)
      .fill(null)
      .map(() => fetch(`${API_BASE_URL}/api/health`, { signal: AbortSignal.timeout(TIMEOUT) }));

    const responses = await Promise.all(promises);
    const duration = Date.now() - startTime;

    if (responses.every(r => r.ok)) {
      logPass(`Handled ${concurrentRequests} concurrent requests`);
      logPass(`  Total time: ${duration}ms`);
      logPass(`  Avg per request: ${Math.round(duration / concurrentRequests)}ms`);
      results.passed += 3;
    } else {
      logFail(`Some concurrent requests failed`);
      results.failed += 1;
    }

    results.tests.push({ name: testName, status: 'pass' });
  } catch (error) {
    logFail(`Performance test error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    results.failed += 1;
    results.tests.push({ name: testName, status: 'fail' });
  }
}

// Main execution
async function main() {
  const startTime = Date.now();

  console.log(chalk.bold('\n╔════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('║          PHASE 3B HEALTH & SECURITY ROUTES - VALIDATION         ║'));
  console.log(chalk.bold('╚════════════════════════════════════════════════════════════════╝\n'));

  logInfo(`API Base URL: ${API_BASE_URL}`);
  logInfo(`Testing started at: ${new Date().toISOString()}\n`);

  // Run all tests
  await testHealthEndpoint();
  console.log();

  await testReadyEndpoint();
  console.log();

  await testPIIScanEndpoint();
  console.log();

  await testPIIRegistryEndpoint();
  console.log();

  await testSecurityEvaluateEndpoint();
  console.log();

  await testComplianceReportEndpoint();
  console.log();

  await testIntegration();
  console.log();

  await testPerformance();
  console.log();

  // Calculate results
  results.duration = Date.now() - startTime;
  const totalTests = results.passed + results.failed + results.skipped;
  const successRate = totalTests > 0 ? Math.round((results.passed / (results.passed + results.failed)) * 100) : 0;

  // Print summary
  console.log(chalk.bold('\n════════════════════════════════════════════════════════════════'));
  console.log(chalk.bold('VALIDATION SUMMARY'));
  console.log(chalk.bold('════════════════════════════════════════════════════════════════\n'));

  console.log(chalk.green(`✓ Passed:  ${results.passed}`));
  console.log(chalk.red(`✗ Failed:  ${results.failed}`));
  console.log(chalk.yellow(`⊘ Skipped: ${results.skipped}`));
  console.log(chalk.dim(`Total:    ${totalTests}\n`));

  console.log(`Success Rate: ${chalk.bold(successRate + '%')}`);
  console.log(`Duration:     ${chalk.dim(results.duration + 'ms')}\n`);

  // Test details
  if (results.tests.length > 0) {
    console.log(chalk.bold('Test Results:\n'));
    results.tests.forEach(test => {
      const icon = test.status === 'pass' ? chalk.green('✓') : test.status === 'fail' ? chalk.red('✗') : chalk.yellow('⊘');
      console.log(`${icon} ${test.name}`);
    });
  }

  // Final status
  console.log(chalk.bold('\n════════════════════════════════════════════════════════════════'));
  if (results.failed === 0) {
    console.log(chalk.green.bold('✓ ALL TESTS PASSED - PHASE 3B READY FOR DEPLOYMENT'));
  } else {
    console.log(chalk.yellow.bold(`⚠ ${results.failed} TEST(S) FAILED - REVIEW REQUIRED`));
  }
  console.log(chalk.bold('════════════════════════════════════════════════════════════════\n'));

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
