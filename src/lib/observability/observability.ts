/**
 * This file acts as a conditional entry point for the observability service.
 *
 * It uses a simple check to determine if it's running in a Node.js or
 * Edge environment and exports the appropriate service. This prevents Node.js-specific
 * modules from being bundled into edge middleware.
 */

// A simple way to check for edge environment.
// Vercel sets process.env.NEXT_RUNTIME = 'edge' for edge functions/middleware.
const isEdge = process.env.NEXT_RUNTIME === 'edge';

let observabilityService;

if (isEdge) {
  observabilityService = require('./edge-observability').observability;
} else {
  observabilityService = require('./node-observability').observability;
}

export const observability = observabilityService;
