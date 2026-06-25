/**
 * Jest config for integration tests.
 *
 * These tests require live env vars (Supabase, Evolution, Paystack) and a
 * running dev server (`npm run dev`).
 *
 * Run: npm run test:integration
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',  // integration tests use fetch/node APIs, not jsdom
  setupFilesAfterEnv: [],   // no jsdom setup needed
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/tests/evolution-integration.test.ts',
    '<rootDir>/tests/paystack-integration.test.ts',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  // Load .env.local automatically
  setupFiles: ['<rootDir>/tests/integration-setup.ts'],
  // Longer timeout — integration tests hit real networks
  testTimeout: 30000,
};
