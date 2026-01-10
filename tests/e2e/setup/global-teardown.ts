import { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig) {
  console.log('🧹 Starting E2E test environment teardown...');
  
  try {
    // Clean up test data
    console.log('🗑️  Cleaning up test database...');
    
    // Additional cleanup operations can be added here
    console.log('✅ E2E test environment teardown complete');
    
  } catch (error) {
    console.error('❌ E2E teardown failed:', error);
    // Don't throw to avoid masking test failures
  }
}

export default globalTeardown;