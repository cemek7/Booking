import { createHttpHandler } from '../../../../lib/create-http-handler';
import { z } from 'zod';
import {
  getTenantSettings,
  updateTenantSettings,
} from '../../../../lib/services/owner-settings-service';

const TenantSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().optional(),
  vertical: z.enum(['beauty', 'hospitality', 'medicine', 'general']).optional(),
  plan: z.enum(['free', 'standard', 'premium']).optional(),
  timezone: z.string().optional(),
  currency: z.string().optional(),
  booking_window_days: z.number().int().min(1).max(365).optional(),
  cancellation_window_hours: z.number().int().min(0).max(168).optional(),
  auto_confirm: z.boolean().optional(),
  require_phone: z.boolean().optional(),
  allow_walkins: z.boolean().optional(),
  email_notifications: z.boolean().optional(),
  sms_notifications: z.boolean().optional(),
  whatsapp_notifications: z.boolean().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const settingsData = await getTenantSettings(ctx.supabase, ctx.user.tenantId);
    return { success: true, ...settingsData };
  },
  'GET',
  { auth: true, roles: ['owner'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const bodyValidation = TenantSettingsSchema.safeParse(body);

    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }

    const result = await updateTenantSettings(ctx.supabase, ctx.user.tenantId, bodyValidation.data);
    return { success: true, ...result };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);