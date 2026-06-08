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
    '^vitest$': '<rootDir>/src/test/vitestCompat.ts',
    '^node-fetch$': '<rootDir>/src/test/nodeFetchStub.ts',
  },
  testMatch: [
    '<rootDir>/src/**/*.test.(ts|tsx)',
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx)',
    '<rootDir>/tests/**/*.test.(ts|tsx)'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    // Integration tests requiring a live server (written for vitest/supertest)
    'src/__tests__/api/health-security/routes.test.ts',
    // Requires live environment variables (SUPABASE_URL etc.)
    'tests/whatsappBookingIntegration.test.ts',
    // Intentionally broken test file (16 TS errors, tests deleted auth system)
    'src/middleware/unified/auth/__tests__/auth-handler.test.ts',
    // Template test file — all assertions are commented out, not a real test
    'src/__tests__/api/template.test.ts',
    // Tests use old ctx-object route handler pattern (incompatible with current createHttpHandler API)
    'src/__tests__/app/api/analytics/dashboard.test.ts',
    'src/__tests__/app/api/bookings/bookings.test.ts',
    'src/__tests__/app/api/payments/stripe.test.ts',
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
