#!/usr/bin/env node

/**
 * Permission System Test Runner
 * 
 * This script runs comprehensive tests for the permission system including
 * unit tests, integration tests, security tests, and performance validation.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for output formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Test configuration
const testConfig = {
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  coverage: process.argv.includes('--coverage') || process.argv.includes('-c'),
  security: process.argv.includes('--security') || process.argv.includes('-s'),
  performance: process.argv.includes('--performance') || process.argv.includes('-p'),
  watch: process.argv.includes('--watch') || process.argv.includes('-w'),
  bail: process.argv.includes('--bail') || process.argv.includes('-b'),
  updateSnapshots: process.argv.includes('--update') || process.argv.includes('-u')
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logHeader(title) {
  const border = '='.repeat(60);
  log(`\n${border}`, colors.cyan);
  log(`  ${title}`, colors.cyan + colors.bright);
  log(`${border}`, colors.cyan);
}

function logSection(title) {
  log(`\n${colors.blue}▶ ${title}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

async function checkPrerequisites() {
  logSection('Checking Prerequisites');

  // Check if Jest is installed
  try {
    execSync('npx jest --version', { stdio: 'pipe' });
    logSuccess('Jest is available');
  } catch (error) {
    logError('Jest is not installed. Run: npm install --save-dev jest @jest/globals');
    process.exit(1);
  }

  // Check if test configuration exists
  const configPath = path.join(process.cwd(), 'jest.permission.config.ts');
  if (fs.existsSync(configPath)) {
    logSuccess('Permission test configuration found');
  } else {
    logWarning('Permission test configuration not found, using default Jest config');
  }

  // Check if environment variables are set
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    logWarning('NEXT_PUBLIC_SUPABASE_URL not set - some tests may fail');
  } else {
    logSuccess('Supabase configuration detected');
  }

  // Check test directories
  const testDirs = [
    'tests/permissions',
    'tests/security', 
    'tests/setup'
  ];

  for (const dir of testDirs) {
    if (fs.existsSync(dir)) {
      logSuccess(`Test directory ${dir} found`);
    } else {
      logWarning(`Test directory ${dir} not found`);
    }
  }
}

function buildJestCommand() {
  let command = 'npx jest';
  
  // Use permission-specific config if it exists
  const configPath = path.join(process.cwd(), 'jest.permission.config.ts');
  if (fs.existsSync(configPath)) {
    command += ` --config ${configPath}`;
  }

  // Add options based on configuration
  if (testConfig.verbose) {
    command += ' --verbose';
  }

  if (testConfig.coverage) {
    command += ' --coverage --coverageReporters=text --coverageReporters=html';
  }

  if (testConfig.watch) {
    command += ' --watch';
  }

  if (testConfig.bail) {
    command += ' --bail';
  }

  if (testConfig.updateSnapshots) {
    command += ' --updateSnapshot';
  }

  // Filter tests based on flags
  const testPatterns = [];
  
  if (testConfig.security) {
    testPatterns.push('tests/security/**/*.test.ts');
  } else if (testConfig.performance) {
    testPatterns.push('tests/performance/**/*.test.ts');
  } else {
    // Run all permission tests by default
    testPatterns.push('tests/permissions/**/*.test.ts', 'tests/security/**/*.test.ts');
  }

  if (testPatterns.length > 0) {
    command += ` --testPathPattern="${testPatterns.join('|')}"`;
  }

  return command;
}

async function runLinting() {
  logSection('Running Code Quality Checks');
  
  try {
    // Check TypeScript compilation
    execSync('npx tsc --noEmit --project tsconfig.json', { 
      stdio: testConfig.verbose ? 'inherit' : 'pipe' 
    });
    logSuccess('TypeScript compilation check passed');
  } catch (error) {
    logError('TypeScript compilation errors detected');
    if (!testConfig.verbose) {
      log(error.stdout?.toString() || error.message, colors.red);
    }
  }

  try {
    // Run ESLint on test files
    execSync('npx eslint tests/ src/types/unified-*.ts --ext .ts --fix', { 
      stdio: testConfig.verbose ? 'inherit' : 'pipe' 
    });
    logSuccess('ESLint checks passed');
  } catch (error) {
    logWarning('ESLint issues detected (some may be auto-fixed)');
  }
}

async function runTests() {
  logSection('Running Permission System Tests');
  
  const jestCommand = buildJestCommand();
  log(`Executing: ${jestCommand}`, colors.blue);

  try {
    execSync(jestCommand, { 
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });
    logSuccess('All tests completed successfully');
    return true;
  } catch (error) {
    logError('Test execution failed');
    return false;
  }
}

async function generateTestReport() {
  logSection('Generating Test Report');
  
  const reportDir = path.join(process.cwd(), 'tests/reports');
  
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Check for test results
  const junitReport = path.join(reportDir, 'permission-test-results.xml');
  const coverageReport = path.join(process.cwd(), 'coverage/index.html');

  if (fs.existsSync(junitReport)) {
    logSuccess(`JUnit test report: ${junitReport}`);
  }

  if (fs.existsSync(coverageReport)) {
    logSuccess(`Coverage report: ${coverageReport}`);
  }

  // Generate summary report
  const summaryReport = {
    timestamp: new Date().toISOString(),
    testConfig,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      hasSupabaseConfig: !!process.env.NEXT_PUBLIC_SUPABASE_URL
    },
    reports: {
      junit: fs.existsSync(junitReport),
      coverage: fs.existsSync(coverageReport)
    }
  };

  const summaryPath = path.join(reportDir, 'test-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
  logSuccess(`Test summary: ${summaryPath}`);
}

function displayHelp() {
  log(`
${colors.bright}Permission System Test Runner${colors.reset}

Usage: node run-permission-tests.js [options]

Options:
  -v, --verbose      Verbose output
  -c, --coverage     Generate coverage report
  -s, --security     Run security tests only
  -p, --performance  Run performance tests only
  -w, --watch        Run tests in watch mode
  -b, --bail         Stop on first test failure
  -u, --update       Update test snapshots
  -h, --help         Show this help message

Examples:
  node run-permission-tests.js                    # Run all permission tests
  node run-permission-tests.js --coverage         # Run with coverage
  node run-permission-tests.js --security         # Security tests only
  node run-permission-tests.js --verbose --bail   # Verbose with early exit

Test Categories:
  • Unit Tests        - Individual function validation
  • Integration Tests - Complete workflow testing  
  • Security Tests    - Attack prevention & security validation
  • Performance Tests - Speed & efficiency validation
`, colors.cyan);
}

async function main() {
  // Handle help flag
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    displayHelp();
    return;
  }

  logHeader('🔒 Permission System Test Suite');

  try {
    // Step 1: Check prerequisites
    await checkPrerequisites();

    // Step 2: Run code quality checks
    if (!testConfig.watch) {
      await runLinting();
    }

    // Step 3: Run tests
    const testsPassed = await runTests();

    // Step 4: Generate reports
    if (!testConfig.watch) {
      await generateTestReport();
    }

    // Step 5: Summary
    logHeader('Test Execution Summary');
    
    if (testsPassed) {
      logSuccess('🎉 All permission tests passed successfully!');
      
      if (testConfig.coverage) {
        log('\n📊 Coverage report available in coverage/index.html', colors.blue);
      }
      
      log('\n🔒 Permission system security validated', colors.green);
      process.exit(0);
    } else {
      logError('❌ Some tests failed - check output above');
      log('\n🔧 Fix failing tests and run again', colors.yellow);
      process.exit(1);
    }

  } catch (error) {
    logError(`Test runner error: ${error.message}`);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  log('\n\n🛑 Test execution interrupted by user', colors.yellow);
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logError(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

// Run the test suite
main().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});