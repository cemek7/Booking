export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler, getVerifiedTenantId, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSubaccount, fetchSubaccount, resolveBankAccount, updateSubaccount } from '@/lib/paystack';
import { calculateSettlement } from '@/lib/payments/settlementPolicy';

/** Plan → policy assignment for this release: every tenant is on the pilot policy. */
const ASSIGNED_POLICY = { code: 'pilot_ngn_v1', version: 1 } as const;
const EXAMPLE_AMOUNT_MINOR = 1_000_000; // NGN 10,000

const SetupSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  // Interpolated into a Paystack URL by resolveBankAccount, so keep it strictly alphanumeric.
  settlementBank: z.string().trim().regex(/^[0-9A-Za-z]{2,10}$/, 'Invalid bank code'),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  primaryContactEmail: z.string().trim().email(),
  acceptPolicy: z.object({ code: z.string(), version: z.number().int() }),
});
const UpdateSchema = SetupSchema.omit({ businessName: true });

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function loadPolicy(admin: Admin) {
  const { data, error } = await admin.from('payment_fee_policies')
    .select('code, version, platform_fee_basis_points, platform_fee_cap_minor')
    .eq('code', ASSIGNED_POLICY.code).eq('version', ASSIGNED_POLICY.version).maybeSingle();
  if (error || !data) throw ApiErrorFactory.internalServerError(new Error('Fee policy missing'));
  return {
    code: data.code as string,
    version: data.version as number,
    basisPoints: data.platform_fee_basis_points as number,
    capMinor: data.platform_fee_cap_minor === null ? null : Number(data.platform_fee_cap_minor),
    feeBearer: 'subaccount' as const,
  };
}

function validationError(error: z.ZodError) {
  return ApiErrorFactory.validationError(Object.fromEntries(error.issues.map((i) => [i.path.join('.') || '_', i.message])));
}

function policyChanged() {
  return NextResponse.json(
    { success: false, code: 'POLICY_CHANGED', error: 'The fee policy changed. Review and accept it again.' },
    { status: 409 }
  );
}

function suspended() {
  return NextResponse.json(
    { success: false, code: 'ACCOUNT_SUSPENDED', error: 'Payments are suspended for this business. Contact Booka support.' },
    { status: 409 }
  );
}

/** Verify the bank account with Paystack before anything is created or changed. */
async function verifyBank(accountNumber: string, settlementBank: string): Promise<string> {
  const bank = await resolveBankAccount(accountNumber, settlementBank);
  if (!bank.success || !bank.account) throw ApiErrorFactory.validationError({ accountNumber: 'Could not verify this bank account' });
  return bank.account.accountName;
}

/** Create or re-point a subaccount, then prove Paystack stored what we sent. */
async function provision(args: {
  admin: Admin;
  tenantId: string; userId: string; existingCode: string | null;
  businessName: string; settlementBank: string; accountNumber: string; primaryContactEmail: string;
  accountName: string;
}) {
  const created = args.existingCode
    ? await updateSubaccount(args.existingCode, { settlementBank: args.settlementBank, accountNumber: args.accountNumber, primaryContactEmail: args.primaryContactEmail, percentageCharge: 0 })
    : await createSubaccount({ businessName: args.businessName, settlementBank: args.settlementBank, accountNumber: args.accountNumber, primaryContactEmail: args.primaryContactEmail, percentageCharge: 0 });
  if (!created.success || !created.subaccount) throw ApiErrorFactory.externalServiceError(created.error ?? 'Paystack setup failed');

  const code = created.subaccount.subaccountCode;
  const check = await fetchSubaccount(code);
  const sub = check.success ? check.subaccount : undefined;
  // Paystack returns the bank NAME in settlement_bank, so bank correctness rests on
  // resolveBankAccount (run before provisioning). The full number is compared in memory only.
  const ok = Boolean(sub && typeof sub.percentageCharge === 'number' && sub.percentageCharge === 0
    && String(sub.accountNumber) === args.accountNumber);

  const now = new Date().toISOString();
  const row = {
    tenant_id: args.tenantId, provider: 'paystack', currency: 'NGN', subaccount_code: code,
    status: ok ? 'active' : 'invalid', bank_code: args.settlementBank, account_last4: args.accountNumber.slice(-4),
    account_name: args.accountName, policy_code: ASSIGNED_POLICY.code, policy_version: ASSIGNED_POLICY.version,
    accepted_by: args.userId, accepted_at: now, updated_at: now,
  };
  const { error } = await args.admin.from('tenant_payment_accounts').upsert(row, { onConflict: 'tenant_id,provider,currency' });
  if (error) throw ApiErrorFactory.databaseError(error);
  if (!ok) {
    return NextResponse.json(
      { success: false, code: 'SUBACCOUNT_MISMATCH', error: 'Paystack did not confirm the settlement details. Contact Booka support.' },
      { status: 502 }
    );
  }
  return { success: true, status: 'active', account: { bankCode: row.bank_code, accountLast4: row.account_last4, accountName: row.account_name } };
}

export const GET = createHttpHandler(async (ctx) => {
  const tenantId = getVerifiedTenantId(ctx);
  const admin = createSupabaseAdminClient();
  const policy = await loadPolicy(admin);
  const { data } = await admin.from('tenant_payment_accounts')
    .select('status, bank_code, account_last4, account_name')
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN').maybeSingle();
  return {
    configured: data?.status === 'active',
    status: data?.status ?? null,
    account: data ? { bankCode: data.bank_code, accountLast4: data.account_last4, accountName: data.account_name } : null,
    policy: { code: policy.code, version: policy.version, basisPoints: policy.basisPoints, capMinor: policy.capMinor },
    example: calculateSettlement(EXAMPLE_AMOUNT_MINOR, policy),
  };
}, 'GET', { auth: true, roles: ['owner'] });

export const POST = createHttpHandler(async (ctx) => {
  const parsed = SetupSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
  if (!parsed.success) throw validationError(parsed.error);
  const body = parsed.data;
  if (body.acceptPolicy.code !== ASSIGNED_POLICY.code || body.acceptPolicy.version !== ASSIGNED_POLICY.version) return policyChanged();
  const tenantId = getVerifiedTenantId(ctx);
  const admin = createSupabaseAdminClient();
  await loadPolicy(admin); // fail before any Paystack call if the policy row is missing
  const { data: existing } = await admin.from('tenant_payment_accounts').select('status, subaccount_code')
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN').maybeSingle();
  if (existing?.status === 'active') {
    return NextResponse.json({ success: false, code: 'ALREADY_CONFIGURED', error: 'Payments are already set up. Use update instead.' }, { status: 409 });
  }
  if (existing?.status === 'suspended') return suspended();
  const accountName = await verifyBank(body.accountNumber, body.settlementBank);
  // Reuse a half-set-up subaccount (pending/invalid) rather than orphaning it.
  const existingCode = (existing?.subaccount_code as string | null | undefined) ?? null;
  return provision({ admin, tenantId, userId: ctx.user!.id, existingCode, accountName, ...body });
}, 'POST', { auth: true, roles: ['owner'] });

export const PUT = createHttpHandler(async (ctx) => {
  const parsed = UpdateSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
  if (!parsed.success) throw validationError(parsed.error);
  const body = parsed.data;
  if (body.acceptPolicy.code !== ASSIGNED_POLICY.code || body.acceptPolicy.version !== ASSIGNED_POLICY.version) return policyChanged();
  const tenantId = getVerifiedTenantId(ctx);
  const admin = createSupabaseAdminClient();
  await loadPolicy(admin);
  const { data: existing } = await admin.from('tenant_payment_accounts').select('status, subaccount_code')
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN').maybeSingle();
  if (existing?.status === 'suspended') return suspended();
  if (!existing?.subaccount_code) throw ApiErrorFactory.badRequest('No payment account to update');
  // A typo must not switch off working collection: resolve the bank first.
  const accountName = await verifyBank(body.accountNumber, body.settlementBank);
  // Collection stops while the bank change is being verified.
  const { error: pendingError } = await admin.from('tenant_payment_accounts')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('provider', 'paystack').eq('currency', 'NGN');
  if (pendingError) throw ApiErrorFactory.databaseError(pendingError);
  const { data: tenant } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return provision({ admin, tenantId, userId: ctx.user!.id, existingCode: existing.subaccount_code as string, accountName, businessName: (tenant?.name as string | undefined) ?? 'Business', ...body });
}, 'PUT', { auth: true, roles: ['owner'] });
