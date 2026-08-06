import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantSettings } from '@/lib/services/owner-settings-service';
import { findDuplicate } from './duplicates';
import { extractAndPersistRecord, buildCaptureReviewAction, type CaptureExtractionRequest, type CaptureRecordType } from './extract';
import { confirmExtraction } from './confirm';
import { createLiveCaptureProvider } from './provider';

type ExtractionJobRow = {
  id: string;
  tenant_id: string;
  media_input_id: string;
  status: 'pending' | 'processing' | 'review_required' | 'confirmed' | 'failed';
  model?: string | null;
  prompt_version?: string | null;
  error?: string | null;
  media_inputs?: {
    id: string;
    kind: CaptureExtractionRequest['kind'];
    storage_path: string;
    mime: string;
    file_hash: string;
    metadata?: Record<string, unknown> | null;
    uploaded_by?: string | null;
  } | null;
};

function parseDuplicateProbe(metadata: Record<string, unknown> | null | undefined) {
  const probe = (metadata?.duplicate_probe ?? {}) as Record<string, unknown>;
  return {
    duplicateMatchId: typeof metadata?.duplicate_match_id === 'string' ? metadata.duplicate_match_id : null,
    amountCents: typeof probe.amountCents === 'number' ? probe.amountCents : null,
    date: typeof probe.date === 'string' ? probe.date : null,
    supplier: typeof probe.supplier === 'string' ? probe.supplier : null,
    reference: typeof probe.reference === 'string' ? probe.reference : null,
  };
}

function mergeDuplicateField(fields: Record<string, unknown>, duplicateMatchId: string | null): Record<string, unknown> {
  if (!duplicateMatchId) return fields;
  return {
    ...fields,
    duplicate_match_id: duplicateMatchId,
  };
}

async function claimPendingJob(admin: SupabaseClient): Promise<ExtractionJobRow | null> {
  const { data: jobs, error } = await admin
    .from('extraction_jobs')
    .select(`
      id,
      tenant_id,
      media_input_id,
      status,
      model,
      prompt_version,
      error,
      media_inputs (
        id,
        kind,
        storage_path,
        mime,
        file_hash,
        metadata,
        uploaded_by
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw error;
  const job = (jobs?.[0] ?? null) as unknown as ExtractionJobRow | null;
  if (!job) return null;

  const { data: claimed, error: claimError } = await admin
    .from('extraction_jobs')
    .update({
      status: 'processing',
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select(`
      id,
      tenant_id,
      media_input_id,
      status,
      model,
      prompt_version,
      error,
      media_inputs (
        id,
        kind,
        storage_path,
        mime,
        file_hash,
        metadata,
        uploaded_by
      )
    `)
    .maybeSingle();

  if (claimError) throw claimError;
  return (claimed as ExtractionJobRow | null) ?? null;
}

async function loadMediaBuffer(admin: SupabaseClient, storagePath: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from('whatsapp-media').download(storagePath);
  if (error || !data) throw error ?? new Error('Failed to download capture media');
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function markJobFailed(admin: SupabaseClient, jobId: string, error: string) {
  await admin
    .from('extraction_jobs')
    .update({
      status: 'failed',
      error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function patchExtractedRecord(
  admin: SupabaseClient,
  recordId: string,
  recordType: CaptureRecordType,
  originalFields: Record<string, unknown>,
  duplicateMatchId: string | null,
) {
  if (!duplicateMatchId) return;
  const fields = mergeDuplicateField(originalFields, duplicateMatchId);
  await admin
    .from('extracted_records')
    .update({
      fields,
      proposed_action: buildCaptureReviewAction(recordType, fields),
    })
    .eq('id', recordId);
}

export async function processOnePendingCaptureJob(admin: SupabaseClient): Promise<{ jobId: string; status: string } | null> {
  const job = await claimPendingJob(admin);
  if (!job) return null;

  try {
    if (!job.media_inputs) {
      throw new Error('Capture job missing media input');
    }

    const media = job.media_inputs;
    const buffer = await loadMediaBuffer(admin, media.storage_path);
    const duplicateProbe = parseDuplicateProbe(media.metadata);
    const duplicateMatchId = duplicateProbe.duplicateMatchId
      ?? await findDuplicate(admin, job.tenant_id, media.file_hash, duplicateProbe);

    const result = await extractAndPersistRecord(
      admin,
      createLiveCaptureProvider(),
      {
        kind: media.kind,
        mime: media.mime,
        buffer,
        tenantId: job.tenant_id,
        jobId: job.id,
        metadata: {
          ...(media.metadata ?? {}),
          fileName: (media.metadata?.original_name as string | undefined) ?? null,
          base64Data: buffer.toString('base64'),
        },
      },
    );

    await patchExtractedRecord(admin, result.extractedRecordId, result.recordType, result.fields, duplicateMatchId);

    if (duplicateMatchId) {
      return { jobId: job.id, status: 'review_required' };
    }

    const settings = await getTenantSettings(admin, job.tenant_id);
    const autoConfirmEnabled = Boolean(settings.settings.auto_confirm);
    if (!autoConfirmEnabled || result.lowConfidenceFields.length > 0) {
      return { jobId: job.id, status: 'review_required' };
    }

    await confirmExtraction(
      admin,
      result.extractedRecordId,
      media.uploaded_by ?? 'system',
      ['RECORD_SALES', 'RECORD_EXPENSES', 'RECORD_PURCHASES', 'RECORD_PAYMENTS', 'ADJUST_INVENTORY', 'COMPLETE_SERVICES'],
    );
    return { jobId: job.id, status: 'confirmed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    defaultLogger.error('[capture] failed to process extraction job', { jobId: job.id, error: message });
    await markJobFailed(admin, job.id, message);
    return { jobId: job.id, status: 'failed' };
  }
}

export async function runCaptureQueue(admin: SupabaseClient, limit = 10): Promise<{ processed: number; results: Array<{ jobId: string; status: string }> }> {
  const results: Array<{ jobId: string; status: string }> = [];
  for (let i = 0; i < limit; i += 1) {
    const result = await processOnePendingCaptureJob(admin);
    if (!result) break;
    results.push(result);
  }
  return { processed: results.length, results };
}

export async function runCaptureQueueWithAdmin(limit = 10) {
  return runCaptureQueue(createSupabaseAdminClient(), limit);
}
