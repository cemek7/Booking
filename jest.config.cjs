/**
 * Jest config using ts-jest.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^tinypool$': '<rootDir>/src/test/tinypoolStub.ts',
    // node-fetch is not installed; jest.setup.ts imports it globally, so stub it.
    '^node-fetch$': '<rootDir>/src/test/nodeFetchStub.ts',
  },
  testMatch: [
    '<rootDir>/src/**/*.test.(ts|tsx)',
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx)',
    '<rootDir>/tests/**/*.test.(ts|tsx)'
  ],
  // Integration suites hit a live server (localhost:3000 / INTEGRATION_APP_URL)
  // and real third-party APIs. They are matched by jest.integration.config.cjs
  // and run via `npm run test:integration`. Without this they also get picked up
  // by the unit run above, where they fail on unreachable network rather than on
  // anything about the code under test.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/evolution-integration.test.ts',
    '<rootDir>/tests/paystack-integration.test.ts',
    '<rootDir>/src/__tests__/api/health-security/routes.test.ts',
    // A copy-me scaffold for new route tests, not a test itself: it describes
    // "ENDPOINT_NAME", calls jest.mock() inside a helper, and imports the
    // non-existent @/lib/auth. Kept as a reference, excluded from the run.
    '<rootDir>/src/__tests__/api/template.test.ts',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};
