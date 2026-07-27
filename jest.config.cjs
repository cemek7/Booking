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
  // Live-DB smoke runs only via jest.livesmoke.config.cjs (needs SUPABASE creds).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/live-smoke/'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};
