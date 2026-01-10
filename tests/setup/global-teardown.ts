/**
 * Global test teardown for permission system tests
 * 
 * This file runs once after all test suites and cleans up the global test environment.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function globalTeardown() {
  console.log('🧹 Cleaning up permission system tests...');

  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const supabase = createServerSupabaseClient();

      // Clean up all test data
      await cleanupAllTestData(supabase);
    }

    console.log('✅ Test cleanup completed');

  } catch (error) {
    console.warn('⚠️ Test cleanup had issues:', error);
  }
}

async function cleanupAllTestData(supabase: any) {
  try {
    // Clean up test data in proper order (respecting foreign keys)
    const cleanupQueries = [
      // Remove tenant users first
      supabase.from('tenant_users').delete().like('user_id', 'test-%'),
      
      // Remove admin entries
      supabase.from('admins').delete().like('user_id', 'test-%'),
      
      // Remove test tenants
      supabase.from('tenants').delete().like('id', 'test-%'),
      
      // Clean up any other test-related data
      supabase.from('profiles').delete().like('id', 'test-%')
    ];

    await Promise.allSettled(cleanupQueries);
    console.log('🧹 All test data cleaned up');
    
  } catch (error) {
    console.warn('⚠️ Some test data cleanup failed:', error);
  }
}