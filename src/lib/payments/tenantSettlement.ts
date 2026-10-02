import { randomUUID } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { initializeSplitTransaction } from '@/lib/paystack';
import { defaultLogger } from '@/lib/logger';
import { calculateSettlement, isValidAmountMinor, type FeePolicy } from './settlementPolicy';

/**
 * The only initializer for tenant customer payments (spec 2026-10-02 §5).
 * Fails closed: no account, no accepted policy, or collection disabled
 * means no Paystack request and no money collected.
 */

export type TenantPaymentSubject = { type: 'reservation' | 'retail_order' | 'payment_link'; id: string };

export type InitializeTenantPaymentInput = {
  tenantId: string;
  amountMinor: number;
  currency: 'NGN';
  customerEmail: string;
  subject: TenantPaymentSubject;
  idempotencyKey: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

export type SettlementSnapshot = {
  amountMinor: number;
  platformFeeMinor: number;
  tenantGrossMinor: number;
  subaccountCode: string;
  feeBearer: 'subaccount';
  policyCode: string;
  policyVersion: number;
};

export type SettlementFailureCode =
  | 'SETTLEMENT_DISABLED'
  | 'INVALID_AMOUNT_MINOR'
  | 'CURRENCY_NOT_SUPPORTED'
  | 'CUSTOMER_EMAIL_REQUIRED'
  | 'SETTLEMENT_NOT_CONFIGURED'
  | 'POLICY_NOT_ACCEPTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'TRANSACTION_INSERT_FAILED'
  | 'PROVIDER_INITIALIZATION_FAILED';

export type InitializeTenantPaymentResult =
  | { ok: true; transactionId: string; reference: string; authorizationUrl: string; snapshot: SettlementSnapshot; reused: boolean }
  | { ok: false; code: SettlementFailureCode; message: string };

/** Safe for customers and owners; never reveals configuration detail. */
export const SETTLEMENT_CUSTOMER_MESSAGE = 'Online payment is not available for this business right now.';

export type StoredAccount = {
  subaccountCode: string | null;
  status: 'pending' | 'active' | 'suspended' | 'invalid';
  accepted: boolean;
  policyCode: string;
  policyVersion: number;
};

export type ExistingSettlement = {
  id: string;
  status: string;
  providerReference: string | null;
  authorizationUrl: string | null;
  subjectType: string | null;
  subjectId: string | null;
  amountMinor: number | null;
  platformFeeMinor: number | null;
  subaccountCode: string | null;
  policyCode: string | null;
  policyVersion: number | null;
};

export interface SettlementStore {
  loadAccount(tenantId: string, currency: 'NGN'): Promise<StoredAccount | null>;
  loadPolicy(code: string, version: number): Promise<FeePolicy | null>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<ExistingSettlement | null>;
  insertPending(row: Record<string, unknown>): Promise<{ id: string }>;
  markInitialized(id: string, authorizationUrl: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

const TRANSACTION_TYPE: Record<TenantPaymentSubject['type'], string> = {
  reservation: 'deposit',
  retail_order: 'retail_order',
  payment_link: 'payment_link',
};

const PLACEHOLDER_EMAILS = new Set(['noemail@example.com']);

export function isTenantPaymentsEnabled(): boolean {
  return process.env.BOOKA_TENANT_PAYMENTS === 'live';
}

function fail(code: SettlementFailureCode, message: string): InitializeTenantPaymentResult {
  return { ok: false, code, message };
}

export async function initializeTenantPayment(
  input: InitializeTenantPaymentInput,
  store: SettlementStore = defaultStore(),
): Promise<InitializeTenantPaymentResult> {
  if (!isTenantPaymentsEnabled()) return fail('SETTLEMENT_DISABLED', SETTLEMENT_CUSTOMER_MESSAGE);
  if (!isValidAmountMinor(input.amountMinor)) return fail('INVALID_AMOUNT_MINOR', 'Amount must be a positive whole number of kobo');
  if (input.currency !== 'NGN') return fail('CURRENCY_NOT_SUPPORTED', 'Only NGN payments are supported');
  const email = input.customerEmail?.trim().toLowerCase() ?? '';
  if (!email || PLACEHOLDER_EMAILS.has(email)) return fail('CUSTOMER_EMAIL_REQUIRED', 'A customer email is required');

  const account = await store.loadAccount(input.tenantId, 'NGN');
  if (!account || account.status !== 'active' || !account.subaccountCode) {
    return fail('SETTLEMENT_NOT_CONFIGURED', SETTLEMENT_CUSTOMER_MESSAGE);
  }
  if (!account.accepted) return fail('POLICY_NOT_ACCEPTED', SETTLEMENT_CUSTOMER_MESSAGE);
  const policy = await store.loadPolicy(account.policyCode, account.policyVersion);
  if (!policy) return fail('SETTLEMENT_NOT_CONFIGURED', SETTLEMENT_CUSTOMER_MESSAGE);

  const amounts = calculateSettlement(input.amountMinor, policy);
  const snapshot: SettlementSnapshot = {
    ...amounts,
    subaccountCode: account.subaccountCode,
    feeBearer: 'subaccount',
    policyCode: policy.code,
    policyVersion: policy.version,
  };

  const existing = await store.findByIdempotencyKey(input.tenantId, input.idempotencyKey);
  if (existing) {
    const matches = existing.status === 'pending'
      && existing.subjectType === input.subject.type
      && existing.subjectId === input.subject.id
      && existing.amountMinor === snapshot.amountMinor
      && existing.platformFeeMinor === snapshot.platformFeeMinor
      && existing.subaccountCode === snapshot.subaccountCode
      && existing.policyCode === snapshot.policyCode
      && existing.policyVersion === snapshot.policyVersion
      && Boolean(existing.providerReference && existing.authorizationUrl);
    if (!matches) return fail('IDEMPOTENCY_CONFLICT', 'A different payment already exists for this request');
    return { ok: true, transactionId: existing.id, reference: existing.providerReference!, authorizationUrl: existing.authorizationUrl!, snapshot, reused: true };
  }

  const reference = `bk_${randomUUID().replace(/-/g, '')}`;
  let inserted: { id: string };
  try {
    inserted = await store.insertPending({
      tenant_id: input.tenantId,
      amount: snapshot.amountMinor / 100, // legacy major-unit column (spec §4.2)
      currency: 'NGN',
      type: TRANSACTION_TYPE[input.subject.type],
      status: 'pending',
      provider_reference: reference,
      subject_type: input.subject.type,
      subject_id: input.subject.id,
      amount_minor: snapshot.amountMinor,
      platform_fee_minor: snapshot.platformFeeMinor,
      tenant_gross_minor: snapshot.tenantGrossMinor,
      settlement_subaccount_code: snapshot.subaccountCode,
      settlement_fee_bearer: snapshot.feeBearer,
      settlement_policy_code: snapshot.policyCode,
      settlement_policy_version: snapshot.policyVersion,
      settlement_idempotency_key: input.idempotencyKey,
      settlement_verification_status: 'pending',
      raw: { provider: 'paystack', ref: reference, email, subject: input.subject },
    });
  } catch (error) {
    defaultLogger.error('[tenantSettlement] pending insert failed', { tenantId: input.tenantId, error: (error as Error).message });
    return fail('TRANSACTION_INSERT_FAILED', 'Could not start the payment. Please try again.');
  }

  const init = await initializeSplitTransaction({
    email,
    amountMinor: snapshot.amountMinor,
    reference,
    currency: 'NGN',
    subaccountCode: snapshot.subaccountCode,
    transactionChargeMinor: snapshot.platformFeeMinor,
    callbackUrl: input.callbackUrl,
    metadata: { ...input.metadata, booka_subject_type: input.subject.type },
  }).catch((error: Error) => ({ success: false as const, error: error.message, authorizationUrl: undefined }));

  if (!init.success || !init.authorizationUrl) {
    await store.markFailed(inserted.id, init.error ?? 'no_authorization_url');
    return fail('PROVIDER_INITIALIZATION_FAILED', 'Could not start the payment. Please try again.');
  }

  await store.markInitialized(inserted.id, init.authorizationUrl);
  return { ok: true, transactionId: inserted.id, reference, authorizationUrl: init.authorizationUrl, snapshot, reused: false };
}

function defaultStore(): SettlementStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadAccount(tenantId, currency) {
      const { data, error } = await admin
        .from('tenant_payment_accounts')
        .select('subaccount_code, status, accepted_at, accepted_by, policy_code, policy_version')
        .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', currency)
        .maybeSingle();
      if (error) throw new Error(`payment account lookup failed: ${error.message}`);
      if (!data) return null;
      return {
        subaccountCode: data.subaccount_code,
        status: data.status,
        accepted: Boolean(data.accepted_at && data.accepted_by),
        policyCode: data.policy_code,
        policyVersion: data.policy_version,
      };
    },
    async loadPolicy(code, version) {
      const { data, error } = await admin
        .from('payment_fee_policies')
        .select('code, version, platform_fee_basis_points, platform_fee_cap_minor, fee_bearer, active')
        .eq('code', code).eq('version', version).maybeSingle();
      if (error) throw new Error(`fee policy lookup failed: ${error.message}`);
      if (!data || !data.active) return null;
      return {
        code: data.code,
        version: data.version,
        basisPoints: data.platform_fee_basis_points,
        capMinor: data.platform_fee_cap_minor === null ? null : Number(data.platform_fee_cap_minor),
        feeBearer: 'subaccount',
      };
    },
    async findByIdempotencyKey(tenantId, key) {
      const { data, error } = await admin
        .from('transactions')
        .select('id, status, provider_reference, raw, subject_type, subject_id, amount_minor, platform_fee_minor, settlement_subaccount_code, settlement_policy_code, settlement_policy_version')
        .eq('tenant_id', tenantId).eq('settlement_idempotency_key', key).maybeSingle();
      if (error) throw new Error(`idempotency lookup failed: ${error.message}`);
      if (!data) return null;
      const raw = (data.raw ?? {}) as { authorization_url?: string };
      return {
        id: data.id,
        status: data.status,
        providerReference: data.provider_reference,
        authorizationUrl: raw.authorization_url ?? null,
        subjectType: data.subject_type,
        subjectId: data.subject_id,
        amountMinor: data.amount_minor === null ? null : Number(data.amount_minor),
        platformFeeMinor: data.platform_fee_minor === null ? null : Number(data.platform_fee_minor),
        subaccountCode: data.settlement_subaccount_code,
        policyCode: data.settlement_policy_code,
        policyVersion: data.settlement_policy_version,
      };
    },
    async insertPending(row) {
      const { data, error } = await admin.from('transactions').insert(row).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'insert returned no row');
      return { id: data.id };
    },
    async markInitialized(id, authorizationUrl) {
      const { data } = await admin.from('transactions').select('raw').eq('id', id).maybeSingle();
      const raw = (data?.raw ?? {}) as Record<string, unknown>;
      const { error } = await admin.from('transactions').update({ raw: { ...raw, authorization_url: authorizationUrl } }).eq('id', id);
      if (error) defaultLogger.warn('[tenantSettlement] could not store checkout url', { id, error: error.message });
    },
    async markFailed(id, message) {
      const { error } = await admin.from('transactions')
        .update({ status: 'failed', settlement_verification_status: 'not_applicable', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) defaultLogger.error('[tenantSettlement] could not mark failed', { id, error: error.message, cause: message });
    },
  };
}
