/**
 * Enhanced Authentication Module
 * 
 * CONSOLIDATED: Unified implementation that works in both Edge and Node.js runtimes.
 * Previously used runtime-based selection between:
 * - edge-enhanced-auth.ts (115 lines)
 * - node-enhanced-auth.ts (1333 lines)
 * 
 * Now uses single implementation with runtime-aware feature availability.
 * See: enhanced-auth-unified.ts
 */

export { enhancedAuthService, enhancedAuth } from './enhanced-auth-unified';
export type { EnhancedAuthService } from './enhanced-auth-unified';

// For backward compatibility
export { default } from './enhanced-auth-unified';
