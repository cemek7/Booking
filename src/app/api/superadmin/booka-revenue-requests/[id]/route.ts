export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import {
  AuditSummarySchema,
  RequestStatusSchema,
} from '@/lib/booka/revenue-intake';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const PatchSchema = z
  .object({
    status: RequestStatusSchema.optional(),
    qualification_note: z.string().trim().max(2000).optional(),
    audit_summary: AuditSummarySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

function validationDetails(issues: { path: PropertyKey[]; message: string }[]) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
  );
}

export const PATCH = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    if (!id) throw ApiErrorFactory.validationError({ id: 'Request ID is required' });

    const parsed = PatchSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(validationDetails(parsed.error.issues));
    }

    const admin = createSupabaseAdminClient();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.status) updates.status = parsed.data.status;
    if (parsed.data.qualification_note !== undefined) {
      updates.qualification_note = parsed.data.qualification_note || null;
    }

    if (parsed.data.audit_summary) {
      const { data: existing, error: existingError } = await admin
        .from('booka_revenue_requests')
        .select('id, request_type, status')
        .eq('id', id)
        .maybeSingle();

      if (existingError) {
        throw ApiErrorFactory.databaseError(new Error(existingError.message));
      }
      if (!existing) throw ApiErrorFactory.notFound('Booka revenue request');
      if (existing.request_type !== 'missed_revenue_report') {
        throw ApiErrorFactory.validationError({
          audit_summary: 'Audit summaries can only be saved on missed revenue report requests',
        });
      }

      updates.audit_summary = parsed.data.audit_summary;
      updates.status = 'audit_ready';
    }

    const { data, error } = await admin
      .from('booka_revenue_requests')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw ApiErrorFactory.databaseError(new Error(error.message));
    return { data };
  },
  'PATCH',
  { auth: true, roles: ['superadmin'], requireTenantMembership: false },
);
