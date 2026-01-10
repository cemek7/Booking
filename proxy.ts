/**
 * Next.js Middleware Configuration
 * 
 * Integrates HIPAA compliance middleware with Next.js routing
 * to automatically enforce PHI protection across the application
 */

import { NextRequest, NextResponse } from 'next/server';
import { hipaaMiddleware } from '@/middleware/hipaaMiddleware';

export async function middleware(request: NextRequest) {
  // Skip middleware for static files and public assets
  if (
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/static') ||
    request.nextUrl.pathname.includes('.')
  ) {
    return NextResponse.next();
  }
  
  // Apply HIPAA compliance middleware
  const hipaaResponse = await hipaaMiddleware.handle(request);
  if (hipaaResponse) {
    return hipaaResponse; // Return early if middleware blocks the request
  }
  
  // Add security headers for all responses
  const response = NextResponse.next();
  
  // HIPAA-compliant security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), location=()');
  
  // Strict Transport Security for HTTPS
  if (request.nextUrl.protocol === 'https:') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  
  // Content Security Policy for PHI protection
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https:; frame-ancestors 'none';"
  );
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};