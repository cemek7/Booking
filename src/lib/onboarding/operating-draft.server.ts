import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  createOperatingDraftService,
  type OnboardingEvidence,
  type OnboardingEvidenceSourceType,
  type OperatingDraftEvidenceStore,
  type OperatingDraftQuestionId,
} from './operating-draft';

// Server-only wiring for the operating-draft service. Kept out of
// ./operating-draft so client components can import that module's questions
// and types without pulling `@/lib/supabase/server` (and next/headers) into
// the client bundle.

type EvidenceRow = {
  source_type: OnboardingEvidenceSourceType;
  source_reference: string | null;
  extracted_fields: Record<string, unknown> | null;
  owner_edits: Record<string, unknown> | null;
  approval_status: 'draft' | 'approved' | 'rejected';
};

function toEvidence(row: EvidenceRow): OnboardingEvidence {
  return {
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    extractedFields: row.extracted_fields ?? {},
    ownerEdits: row.owner_edits ?? {},
    approvalStatus: row.approval_status,
  };
}

function createSupabaseEvidenceStore(admin: SupabaseClient, tenantId: string): OperatingDraftEvidenceStore {
  return {
    list: async () => {
      const { data, error } = await admin
        .from('onboarding_evidence')
        .select('source_type, source_reference, extracted_fields, owner_edits, approval_status')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`Unable to load onboarding evidence: ${error.message}`);
      return ((data ?? []) as EvidenceRow[]).map(toEvidence);
    },
    append: async (row) => {
      const { error } = await admin.from('onboarding_evidence').insert({
        tenant_id: tenantId,
        source_type: row.sourceType,
        source_reference: row.sourceReference,
        extracted_fields: row.extractedFields,
        owner_edits: row.ownerEdits,
        approval_status: row.approvalStatus,
        approved_by: row.approvedBy ?? null,
        approved_at: row.approvedAt ?? null,
      });
      if (error) throw new Error(`Unable to save onboarding evidence: ${error.message}`);
    },
  };
}

function serviceForTenant(tenantId: string) {
  return createOperatingDraftService({ store: createSupabaseEvidenceStore(createSupabaseAdminClient(), tenantId) });
}

export function getOperatingDraft(tenantId: string) {
  return serviceForTenant(tenantId).getDraft();
}

export function recordOperatingDraftAnswer(input: {
  tenantId: string;
  actorId: string;
  questionId: OperatingDraftQuestionId;
  answer: string;
}) {
  return serviceForTenant(input.tenantId).recordAnswer(input);
}

export function skipOperatingDraftQuestion(input: {
  tenantId: string;
  actorId: string;
  questionId: OperatingDraftQuestionId;
}) {
  return serviceForTenant(input.tenantId).skipQuestion(input);
}

export function addOperatingDraftSource(input: {
  tenantId: string;
  actorId: string;
  sourceType: Exclude<OnboardingEvidenceSourceType, 'owner_answer'>;
  sourceReference: string;
}) {
  return serviceForTenant(input.tenantId).addSource(input);
}

export function approveOperatingDraft(input: { tenantId: string; actorId: string }) {
  return serviceForTenant(input.tenantId).approve(input);
}
