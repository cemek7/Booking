import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/calendar/callback`
);

// Schema for the state parameter passed through OAuth
const StateSchema = z.object({
  tenant_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid(),
  return_url: z.string().url(),
});

/**
 * GET /api/calendar/callback
 * Handles the OAuth2 callback from Google. Exchanges the authorization code
 * for tokens and stores them securely.
 * 
 * NOTE: This handler uses NextResponse.redirect instead of returning data
 * because it's an OAuth callback that needs to redirect back to the app.
 */
export async function GET(request: any) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  let returnUrl = process.env.NEXTAUTH_URL || '';

  try {
    if (error) {
      throw new Error(`Google OAuth error: ${error}`);
    }

    if (!code || !state) {
      throw new Error('Missing authorization code or state from Google.');
    }

    // Decode and validate the state parameter
    const stateData = StateSchema.parse(JSON.parse(Buffer.from(state, 'base64').toString()));
    const { tenant_id, staff_id, user_id, return_url } = stateData;
    returnUrl = return_url;

    // Note: In a real scenario, you might want to validate that the user_id
    // matches the authenticated user. For this refactor, we're keeping
    // the existing pattern but moving to the error-handling structure later.

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to obtain access and refresh tokens from Google.');
    }

    // Get the user's primary calendar ID using the new tokens
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarResponse = await calendar.calendars.get({ calendarId: 'primary' });
    const primaryCalendar = calendarResponse.data;

    // Prepare the data for upserting into the database
    const calendarConfig = {
      tenant_id,
      staff_id: staff_id || null,
      provider: 'google',
      calendar_id: primaryCalendar.id || 'primary',
      calendar_name: primaryCalendar.summary || 'Primary Calendar',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      sync_enabled: true,
      last_synced: null,
      created_by: user_id,
    };

    // Direct Supabase call since this is an unauthenticated callback
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const supabase = createServerSupabaseClient();
    
    const { error: upsertError } = await supabase
      .from('calendar_integrations')
      .upsert(calendarConfig, { onConflict: 'tenant_id, staff_id, provider' });

    if (upsertError) {
      console.error('Failed to save calendar integration:', upsertError);
      throw new Error('Failed to save calendar integration details.');
    }

    // Redirect user back to the application on success
    const successParams = new URLSearchParams({
      calendar_status: 'success',
      message: `Successfully connected calendar: ${calendarConfig.calendar_name}`,
    });
    return NextResponse.redirect(`${returnUrl}?${successParams}`);

  } catch (e) {
    console.error('Google Calendar callback failed:', e);
    const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
    const errorParams = new URLSearchParams({
      calendar_status: 'error',
      error: 'callback_failed',
      message: errorMessage,
    });
    return NextResponse.redirect(`${returnUrl || '/'}?${errorParams}`);
  }
}