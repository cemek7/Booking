/**
 * Global test setup for permission system tests
 * 
 * This file runs once before all test suites and sets up the global test environment.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function globalSetup() {
  console.log('🚀 Setting up permission system tests...');

  // Verify test environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for testing');
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required for testing');
  }

  try {
    // Test Supabase connection
    const supabase = createServerSupabaseClient();

    // Verify connection with a simple query
    const { data, error } = await supabase
      .from('tenants')
      .select('count')
      .limit(1);

    if (error && !error.message.includes('JWT')) {
      throw new Error(`Supabase connection failed: ${error.message}`);
    }

    console.log('✅ Supabase connection verified');

    // Clean up any existing test data
    await cleanupTestData(supabase);

    console.log('✅ Test environment ready');

  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  }
}

async function cleanupTestData(supabase: any) {
  try {
    // Remove any existing test data (with error handling for missing tables)
    const cleanupQueries = [
      supabase.from('tenant_users').delete().like('user_id', 'test-%'),
      supabase.from('admins').delete().like('user_id', 'test-%'),
      supabase.from('tenants').delete().like('id', 'test-%')
    ];

    await Promise.allSettled(cleanupQueries);
    console.log('🧹 Cleaned up existing test data');
  } catch (error) {
    console.warn('⚠️ Test data cleanup had issues (this is often expected):', error);
  }
}