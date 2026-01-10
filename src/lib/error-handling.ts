import { NextRequest, NextResponse } from 'next/server';
import { Session } from '@supabase/supabase-js';

export interface AuthenticatedRequest extends NextRequest {
  session?: Session;
  tenantId?: string;
}

export function handleApiError(error: unknown, message: string) {
  console.error(`${message}:`, error);
  const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
  
  // Specific error handling can be added here based on error codes
  if (error instanceof Error) {
      // Example: Handle Supabase/PostgREST error codes
      const pgError = error as any;
      if (pgError.code) {
          switch(pgError.code) {
              case '23505': // unique_violation
                  return NextResponse.json({ error: 'A resource with the same identifier already exists.', code: pgError.code }, { status: 409 });
              case '23503': // foreign_key_violation
                  return NextResponse.json({ error: 'A related resource does not exist.', code: pgError.code }, { status: 400 });
              case 'PGRST116': // Not found
                  return NextResponse.json({ error: 'Resource not found.' }, { status: 404 });
          }
      }
  }

  return NextResponse.json({ error: 'Internal Server Error', details: errorMessage }, { status: 500 });
}
