export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { convertMentionToLead } from '@/lib/listening/convert';

const ConvertMentionSchema = z.object({
  phone: z.string().trim().min(1),
  name: z.string().trim().optional(),
  email: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    const tenantId = ctx.user?.tenantId;
    if (!id || !tenantId) {
      throw ApiErrorFactory.validationError({ id: 'id + tenant required' });
    }

    const body = await parseJsonBody<unknown>(ctx.request);
    const parsed = ConvertMentionSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const admin = createSupabaseAdminClient();
    await convertMentionToLead(admin, {
      mentionId: id,
      tenantId,
      contact: {
        phone: parsed.data.phone,
        name: parsed.data.name,
        email: parsed.data.email,
        notes: parsed.data.notes,
      },
    });

    return { success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
