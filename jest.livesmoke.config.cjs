/**
 * Jest config for the scoped, self-cleaning live DB smoke.
 *
 * Runs the REAL ops-intel flow code against a real Supabase (service role),
 * scoped to a throwaway tenant that is torn down in an afterAll/finally.
 *
 * Requires env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 * Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx jest --config jest.livesmoke.config.cjs --runInBand
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/tests/live-smoke/**/*.smoke.test.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testTimeout: 60000,
};
