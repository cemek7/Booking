export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, getRouteParam, getVerifiedTenantId } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { buildCaptureReviewAction, type CaptureRecordType } from '@/lib/capture/extract';

const PatchSchema = z.object({
  action: z.enum(['update', 'reject']).default('update'),
  fields: z.record(z.string(), z.unknown()).optional(),
  note: z.string().trim().max(1000).optional(),
});

type ExtractionRecord = {
  id: string;
  tenant_id: string;
  job_id: string;
  record_type: CaptureRecordType;
  fields: Record<string, unknown> | null;
};

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = getVerifiedTenantId(ctx);
    const id = getRouteParam(ctx.params, 'id');
    const parsed = PatchSchema.safeParse((await ctx.request.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError({ issues: parsed.error.issues });
    }

    const { data: record, error } = await ctx.supabase
      .from('extracted_records')
      .select('id, tenant_id, job_id, record_type, fields')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single<ExtractionRecord>();

    if (error || !record) {
      throw ApiErrorFactory.notFound('Capture record not found');
    }

    if (parsed.data.action === 'reject') {
      const { error: rejectError } = await ctx.supabase
        .from('extraction_jobs')
        .update({
          status: 'failed',
          error: parsed.data.note?.length ? `rejected:${parsed.data.note}` : 'rejected_by_owner',
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.job_id)
        .eq('tenant_id', tenantId);
      if (rejectError) throw ApiErrorFactory.databaseError(rejectError);
      return { ok: true, status: 'failed' };
    }

    const nextFields = {
      ...(record.fields ?? {}),
      ...(parsed.data.fields ?? {}),
    };

    const { error: updateError } = await ctx.supabase
      .from('extracted_records')
      .update({
        fields: nextFields,
        proposed_action: buildCaptureReviewAction(record.record_type, nextFields),
      })
      .eq('tenant_id', tenantId)
      .eq('id', record.id);

    if (updateError) throw ApiErrorFactory.databaseError(updateError);
    return { ok: true, fields: nextFields };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] },
);
