export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { ingestMedia, type MediaInputKind } from '@/lib/capture/ingest';
import { findDuplicate } from '@/lib/capture/duplicates';
import { BOOKA_PERMISSIONS } from '@/types/permissions';

const ALLOWED_UPLOAD_PERMISSIONS = new Set<string>([
  BOOKA_PERMISSIONS.RECORD_SALES,
  BOOKA_PERMISSIONS.RECORD_EXPENSES,
  BOOKA_PERMISSIONS.RECORD_PURCHASES,
  BOOKA_PERMISSIONS.RECORD_PAYMENTS,
  BOOKA_PERMISSIONS.PERFORM_STOCK_COUNTS,
  BOOKA_PERMISSIONS.COMPLETE_SERVICES,
]);

function isSupportedKind(value: string): value is MediaInputKind {
  return ['receipt', 'invoice', 'voice', 'photo', 'pdf', 'stock_sheet', 'screenshot', 'service_note'].includes(value);
}

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Missing tenant context');

    const userPermissions = new Set(ctx.user?.permissions ?? []);
    const hasUploadPermission = ctx.user?.role === 'owner' || ctx.user?.role === 'superadmin'
      || [...ALLOWED_UPLOAD_PERMISSIONS].some((permission) => userPermissions.has(permission));

    if (!hasUploadPermission) {
      throw ApiErrorFactory.forbidden('Insufficient permission to upload capture media');
    }

    const contentType = ctx.request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      throw ApiErrorFactory.badRequest('multipart/form-data upload is required');
    }

    const form = await ctx.request.formData();
    const file = form.get('file');
    const rawKind = String(form.get('kind') || '').trim();
    if (!(file instanceof File)) {
      throw ApiErrorFactory.badRequest('file is required');
    }
    if (!isSupportedKind(rawKind)) {
      throw ApiErrorFactory.badRequest('Unsupported capture kind');
    }

    const duplicateProbe = form.get('duplicate_probe')
      ? JSON.parse(String(form.get('duplicate_probe')))
      : {
          amountCents: form.get('amount_cents') ? Number(form.get('amount_cents')) : null,
          date: form.get('date') ? String(form.get('date')) : null,
          supplier: form.get('supplier') ? String(form.get('supplier')) : null,
          reference: form.get('reference') ? String(form.get('reference')) : null,
        };

    const admin = createSupabaseAdminClient();
    const buffer = Buffer.from(await file.arrayBuffer());
    const ingestResult = await ingestMedia(admin, tenantId, {
      kind: rawKind,
      buffer,
      mime: file.type || 'application/octet-stream',
      uploadedBy: ctx.user?.id ?? null,
      source: 'dashboard',
      fileName: file.name,
      metadata: {
        original_name: file.name,
        duplicate_probe: duplicateProbe,
      },
    });

    const duplicateMatchId = await findDuplicate(
      admin,
      tenantId,
      ingestResult.hash,
      {
        amountCents: typeof duplicateProbe?.amountCents === 'number' ? duplicateProbe.amountCents : null,
        date: typeof duplicateProbe?.date === 'string' ? duplicateProbe.date : null,
        supplier: typeof duplicateProbe?.supplier === 'string' ? duplicateProbe.supplier : null,
        reference: typeof duplicateProbe?.reference === 'string' ? duplicateProbe.reference : null,
      },
    );

    if (duplicateMatchId) {
      await admin
        .from('extraction_jobs')
        .update({
          status: 'review_required',
          error: `duplicate_match:${duplicateMatchId}`,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('id', ingestResult.extractionJobId);
    }

    return {
      mediaInputId: ingestResult.mediaInputId,
      extractionJobId: ingestResult.extractionJobId,
      hash: ingestResult.hash,
      storagePath: ingestResult.storagePath,
      duplicateMatchId,
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Missing tenant context');

    const admin = createSupabaseAdminClient();
    const status = ctx.request.nextUrl.searchParams.get('status');
    let query = admin
      .from('extraction_jobs')
      .select(`
        id,
        tenant_id,
        media_input_id,
        status,
        model,
        prompt_version,
        error,
        created_at,
        updated_at,
        media_inputs (
          id,
          kind,
          source,
          storage_path,
          file_hash,
          mime,
          size,
          metadata,
          created_at
        ),
        extracted_records (
          id,
          record_type,
          fields,
          field_confidence,
          low_confidence_fields,
          proposed_action,
          linked_record_type,
          linked_record_id,
          created_at
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw ApiErrorFactory.databaseError(error);

    return { items: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] },
);
