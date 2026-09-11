/**
 * Environment setup for permission tests
 */

import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test.local' });
config({ path: '.env.test' });
config({ path: '.env.local' });
config({ path: '.env' });

// Set test-specific environment variables
process.env.NODE_ENV = 'test';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;