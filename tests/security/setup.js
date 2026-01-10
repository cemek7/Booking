// Security test setup
const { TextEncoder, TextDecoder } = require('util');

// Polyfills for Node.js environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock Supabase for security tests
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ data: [], error: null })),
      insert: jest.fn(() => ({ data: {}, error: null })),
      update: jest.fn(() => ({ data: {}, error: null })),
      delete: jest.fn(() => ({ data: {}, error: null }))
    })),
    auth: {
      signInWithPassword: jest.fn(() => ({ data: { user: {} }, error: null })),
      signOut: jest.fn(() => ({ error: null })),
      getUser: jest.fn(() => ({ data: { user: {} }, error: null }))
    }
  }))
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NEXTAUTH_SECRET = 'test-secret-for-security-tests';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

// Global test timeout
jest.setTimeout(30000);

// Clean up after each test
afterEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
});