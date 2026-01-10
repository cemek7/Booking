import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { google } from 'googleapis';
import { z } from 'zod';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/calendar/callback`
);

const AuthQuerySchema = z.object({
  staff_id: z.string().uuid().optional(),
  return_url: z.string().url().optional(),
});

/**
 * GET /api/calendar/auth
 * Generates a Google OAuth2 authorization URL for calendar integration.
 * Requires authentication with 'owner' or 'manager' role.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify role has calendar management permissions
    const allowedRoles = ['owner', 'manager'];
    if (!ctx.user!.role || !allowedRoles.includes(ctx.user!.role)) {
      throw ApiErrorFactory.forbidden('Insufficient permissions to manage calendar settings');
    }

    const { searchParams } = new URL(ctx.request.url);
    const queryValidation = AuthQuerySchema.safeParse({
      staff_id: searchParams.get('staff_id'),
      return_url: searchParams.get('return_url'),
    });

    if (!queryValidation.success) {
      throw ApiErrorFactory.badRequest('Invalid query parameters', queryValidation.error.issues);
    }

    const { staff_id, return_url } = queryValidation.data;

    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    // The state parameter is used to pass information through the OAuth2 flow
    const state = Buffer.from(
      JSON.stringify({
        tenant_id: tenantId,
        staff_id: staff_id,
        user_id: ctx.user!.id,
        return_url: return_url || '/admin/settings/calendar',
      })
    ).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent',
    });

    return { authorization_url: authUrl };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
