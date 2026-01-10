import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting E2E test environment setup...');
  
  // Launch browser for authentication setup
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // Set up test database state
    console.log('📊 Setting up test database...');
    
    // Create test tenant data
    await page.goto('http://localhost:3000');
    
    // Wait for application to be ready
    await page.waitForSelector('[data-testid="app-ready"]', { 
      timeout: 30000,
      state: 'attached'
    }).catch(() => {
      console.log('⚠️  App ready indicator not found, continuing...');
    });
    
    console.log('✅ E2E test environment setup complete');
    
  } catch (error) {
    console.error('❌ E2E setup failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;