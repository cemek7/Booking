/**
 * Jest Configuration for Permission System Testing
 * 
 * This configuration sets up comprehensive testing for the permission system
 * including unit tests, integration tests, and security validation.
 */

import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  displayName: 'Permission System Tests',
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/*.permission.test.ts',
    '<rootDir>/tests/permissions/**/*.test.ts',
    '<rootDir>/tests/security/**/*.test.ts'
  ],

  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup/permission-test-setup.ts'
  ],

  // Module path mapping
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/types/(.*)$': '<rootDir>/src/types/$1',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1'
  },

  // Coverage configuration
  collectCoverageFrom: [
    'src/types/unified-permissions.ts',
    'src/types/unified-auth.ts',
    'src/types/permissions.ts',
    'src/types/enhanced-permissions.ts',
    'src/lib/rbac.ts',
    'src/lib/enhanced-rbac.ts',
    'src/app/api/**/route.ts'
  ],

  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 90,
      statements: 90
    }
  },

  // Test timeout (permissions involve database calls)
  testTimeout: 10000,

  // Environment variables
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/env.ts'],

  // Transform TypeScript
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        jsx: 'react-jsx'
      }
    }]
  },

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Verbose output for permission tests
  verbose: true,

  // Test reporters
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'tests/reports',
      outputName: 'permission-test-results.xml',
      suiteName: 'Permission System Tests'
    }]
  ],

  // Global setup and teardown
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  globalTeardown: '<rootDir>/tests/setup/global-teardown.ts'
};

export default config;