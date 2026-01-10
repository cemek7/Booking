/**
 * Phase 6: Testing Quality Gates & CI/CD Configuration
 * Comprehensive testing standards and automation setup
 */

// Enhanced Jest configuration with quality gates
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test/jest.setup.ts'],
  
  // Module resolution for enhanced testing framework
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/test/(.*)$': '<rootDir>/src/test/$1',
    '^tinypool$': '<rootDir>/src/test/tinypoolStub.ts'
  },
  
  // Test discovery patterns
  testMatch: [
    '<rootDir>/src/**/*.test.(ts|tsx)',
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx)',
    '<rootDir>/tests/**/*.test.(ts|tsx)',
    '<rootDir>/tests/**/*.integration.test.(ts|tsx)'
  ],
  
  // Ignore patterns for faster testing
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/dist/',
    '<rootDir>/build/',
    '<rootDir>/tests/e2e/' // Playwright handles these
  ],
  
  // Coverage configuration with quality gates
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/**/*.config.{ts,tsx}',
    '!src/test/**',
    '!src/**/__tests__/**',
    '!src/**/*.test.{ts,tsx}'
  ],
  
  // Coverage thresholds (Quality Gates)
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    },
    // Critical paths require higher coverage
    'src/lib/auth/': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95
    },
    'src/app/api/': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'src/lib/bookingFlow/': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  
  // Reporter configuration
  reporters: [
    'default',
    ['jest-junit', { 
      outputDirectory: './test-results',
      outputName: 'unit-test-results.xml',
      suiteNameTemplate: '{filepath}',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}'
    }],
    ['jest-html-reporter', {
      pageTitle: 'Boka Test Results',
      outputPath: './test-results/unit-test-report.html',
      includeFailureMsg: true,
      includeSuiteFailure: true
    }]
  ],
  
  // Performance and timeout configuration
  testTimeout: 10000,
  setupFiles: ['whatwg-fetch'],
  
  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      isolatedModules: true
    }]
  },
  
  // Watch mode configuration
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],
  
  // Globals for consistent test environment
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  },
  
  // Error handling
  errorOnDeprecated: true,
  maxWorkers: '50%',
  
  // Test environment options
  testEnvironmentOptions: {
    url: 'http://localhost:3000'
  }
};