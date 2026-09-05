/**
 * Paystack Extended Service
 *
 * Covers features beyond the basic PaymentProvider interface:
 *   - Bank account resolution / verification
 *   - Transfer recipients
 *   - Transfers (payouts)
 *   - Subaccounts (multi-tenant split settlement)
 *   - Plans & Subscriptions (recurring payments)
 *   - Bank list
 */

import { defaultLogger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return key;
}

interface PaystackResponse<T = unknown> {
  status: boolean;
  message?: string;
  data: T;
  meta?: { total?: number };
  [key: string]: unknown;
}

// Raw Paystack payload shapes. Fields are declared as the calling code already
// assumes them present on a successful response (status === true) — the same
// assumption the previous `@ts-nocheck` made implicitly, so restoring
// typechecking changes types only, never runtime behaviour.
interface PaystackAccountData { account_name: string; account_number: string }
interface PaystackBankItem { name: string; code: string; slug: string }
interface PaystackRecipientData {
  recipient_code: string;
  name: string;
  details: { account_number: string; bank_code: string };
  currency: string;
}
interface PaystackTransferData {
  transfer_code: string;
  status: string;
  amount: number;
  currency: string;
  reference: string;
  reason?: string;
  recipient: { recipient_code: string };
  createdAt: string;
}
interface PaystackSubaccountData {
  subaccount_code: string;
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  primary_contact_email: string;
}
interface PaystackPlanData {
  plan_code: string;
  name: string;
  interval: string;
  amount: number;
  currency: string;
}
interface PaystackSubscriptionData {
  subscription_code: string;
  email_token: string;
  status: string;
  plan: { plan_code: string };
  customer: { email: string };
  next_payment_date?: string;
}

async function paystackFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<PaystackResponse<T>> {
  const res = await fetchWithTimeout(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    timeoutMs: 15_000,
  });
  const data = await res.json();
  return data as PaystackResponse<T>;
}

// ─── Bank Resolution ──────────────────────────────────────────────────────────

export interface BankAccount {
  accountName: string;
  accountNumber: string;
}

/** Verify a bank account number against a bank code (NUBAN). */
export async function resolveBankAccount(
  accountNumber: string,
  bankCode: string
): Promise<{ success: boolean; account?: BankAccount; error?: string }> {
  const data = await paystackFetch<PaystackAccountData>(
    `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
  );
  if (!data.status) {
    return { success: false, error: data.message };
  }
  return {
    success: true,
    account: {
      accountName: data.data.account_name,
      accountNumber: data.data.account_number,
    },
  };
}

/** List supported banks (Nigeria by default). */
export async function listBanks(country = 'nigeria'): Promise<{ success: boolean; banks?: Array<{ name: string; code: string; slug: string }>; error?: string }> {
  const data = await paystackFetch<PaystackBankItem[]>(`/bank?country=${country}&perPage=100`);
  if (!data.status) return { success: false, error: data.message };
  const banks = (data.data || []).map((b) => ({
    name: b.name,
    code: b.code,
    slug: b.slug,
  }));
  return { success: true, banks };
}

// ─── Transfer Recipients ──────────────────────────────────────────────────────

export interface TransferRecipient {
  recipientCode: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
}

/** Create a transfer recipient (required before initiating a transfer). */
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency?: string;
  description?: string;
}): Promise<{ success: boolean; recipient?: TransferRecipient; error?: string }> {
  const data = await paystackFetch<PaystackRecipientData>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency ?? 'NGN',
      description: params.description,
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  return {
    success: true,
    recipient: {
      recipientCode: data.data.recipient_code,
      name: data.data.name,
      accountNumber: data.data.details?.account_number,
      bankCode: data.data.details?.bank_code,
      currency: data.data.currency,
    },
  };
}

/** Fetch a previously created transfer recipient by code. */
export async function fetchTransferRecipient(
  recipientCode: string
): Promise<{ success: boolean; recipient?: TransferRecipient; error?: string }> {
  const data = await paystackFetch<PaystackRecipientData>(`/transferrecipient/${recipientCode}`);
  if (!data.status) return { success: false, error: data.message };
  return {
    success: true,
    recipient: {
      recipientCode: data.data.recipient_code,
      name: data.data.name,
      accountNumber: data.data.details?.account_number,
      bankCode: data.data.details?.bank_code,
      currency: data.data.currency,
    },
  };
}

// ─── Transfers (Payouts) ──────────────────────────────────────────────────────

export interface Transfer {
  transferCode: string;
  status: string;
  amount: number;
  currency: string;
  reference: string;
  reason?: string;
  recipientCode: string;
  createdAt: string;
}

/** Initiate a transfer to a recipient (staff payout, vendor disbursement, etc.). */
export async function initiateTransfer(params: {
  amount: number;           // in major units (naira) — converted to kobo internally
  recipientCode: string;
  reason?: string;
  reference?: string;
  currency?: string;
}): Promise<{ success: boolean; transfer?: Transfer; error?: string }> {
  const reference = params.reference ?? `boka_transfer_${Date.now()}`;
  const data = await paystackFetch<PaystackTransferData>('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(params.amount * 100), // kobo
      recipient: params.recipientCode,
      reason: params.reason,
      reference,
      currency: params.currency ?? 'NGN',
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  const tx = data.data;
  return {
    success: true,
    transfer: {
      transferCode: tx.transfer_code,
      status: tx.status,
      amount: tx.amount / 100,
      currency: tx.currency,
      reference: tx.reference,
      reason: tx.reason,
      recipientCode: params.recipientCode,
      createdAt: tx.createdAt,
    },
  };
}

/** Fetch a transfer by its code. */
export async function fetchTransfer(
  transferCode: string
): Promise<{ success: boolean; transfer?: Transfer; error?: string }> {
  const data = await paystackFetch<PaystackTransferData>(`/transfer/${transferCode}`);
  if (!data.status) return { success: false, error: data.message };
  const tx = data.data;
  return {
    success: true,
    transfer: {
      transferCode: tx.transfer_code,
      status: tx.status,
      amount: tx.amount / 100,
      currency: tx.currency,
      reference: tx.reference,
      reason: tx.reason,
      recipientCode: tx.recipient?.recipient_code,
      createdAt: tx.createdAt,
    },
  };
}

/** List transfers (optionally filter by status). */
export async function listTransfers(params: {
  status?: 'success' | 'pending' | 'failed' | 'reversed';
  perPage?: number;
  page?: number;
} = {}): Promise<{ success: boolean; transfers?: Transfer[]; total?: number; error?: string }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  qs.set('perPage', String(params.perPage ?? 50));
  qs.set('page', String(params.page ?? 1));
  const data = await paystackFetch<PaystackTransferData[]>(`/transfer?${qs}`);
  if (!data.status) return { success: false, error: data.message };
  const transfers: Transfer[] = (data.data || []).map((tx) => ({
    transferCode: tx.transfer_code,
    status: tx.status,
    amount: tx.amount / 100,
    currency: tx.currency,
    reference: tx.reference,
    reason: tx.reason,
    recipientCode: tx.recipient?.recipient_code,
    createdAt: tx.createdAt,
  }));
  return { success: true, transfers, total: data.meta?.total };
}

// ─── Subaccounts ──────────────────────────────────────────────────────────────

export interface Subaccount {
  subaccountCode: string;
  businessName: string;
  settlementBank: string;
  accountNumber: string;
  percentageCharge: number;
  primaryContactEmail: string;
}

/** Create a subaccount for a tenant (used in split-payment settlement). */
export async function createSubaccount(params: {
  businessName: string;
  settlementBank: string;  // bank code, e.g. "044" for Access Bank
  accountNumber: string;
  percentageCharge: number; // platform fee percentage (0–100)
  primaryContactEmail: string;
  primaryContactName?: string;
  primaryContactPhone?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; subaccount?: Subaccount; error?: string }> {
  const data = await paystackFetch<PaystackSubaccountData>('/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: params.businessName,
      settlement_bank: params.settlementBank,
      account_number: params.accountNumber,
      percentage_charge: params.percentageCharge,
      primary_contact_email: params.primaryContactEmail,
      primary_contact_name: params.primaryContactName,
      primary_contact_phone: params.primaryContactPhone,
      metadata: params.metadata,
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  const sub = data.data;
  return {
    success: true,
    subaccount: {
      subaccountCode: sub.subaccount_code,
      businessName: sub.business_name,
      settlementBank: sub.settlement_bank,
      accountNumber: sub.account_number,
      percentageCharge: sub.percentage_charge,
      primaryContactEmail: sub.primary_contact_email,
    },
  };
}

/** Update an existing subaccount. */
export async function updateSubaccount(
  idOrCode: string,
  params: Partial<{
    businessName: string;
    settlementBank: string;
    accountNumber: string;
    percentageCharge: number;
    primaryContactEmail: string;
    primaryContactName: string;
    primaryContactPhone: string;
  }>
): Promise<{ success: boolean; subaccount?: Subaccount; error?: string }> {
  const body: Record<string, unknown> = {};
  if (params.businessName) body.business_name = params.businessName;
  if (params.settlementBank) body.settlement_bank = params.settlementBank;
  if (params.accountNumber) body.account_number = params.accountNumber;
  if (params.percentageCharge !== undefined) body.percentage_charge = params.percentageCharge;
  if (params.primaryContactEmail) body.primary_contact_email = params.primaryContactEmail;
  if (params.primaryContactName) body.primary_contact_name = params.primaryContactName;
  if (params.primaryContactPhone) body.primary_contact_phone = params.primaryContactPhone;

  const data = await paystackFetch<PaystackSubaccountData>(`/subaccount/${idOrCode}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!data.status) return { success: false, error: data.message };
  const sub = data.data;
  return {
    success: true,
    subaccount: {
      subaccountCode: sub.subaccount_code,
      businessName: sub.business_name,
      settlementBank: sub.settlement_bank,
      accountNumber: sub.account_number,
      percentageCharge: sub.percentage_charge,
      primaryContactEmail: sub.primary_contact_email,
    },
  };
}

/** Fetch a single subaccount by id or code. */
export async function fetchSubaccount(
  idOrCode: string
): Promise<{ success: boolean; subaccount?: Subaccount; error?: string }> {
  const data = await paystackFetch<PaystackSubaccountData>(`/subaccount/${idOrCode}`);
  if (!data.status) return { success: false, error: data.message };
  const sub = data.data;
  return {
    success: true,
    subaccount: {
      subaccountCode: sub.subaccount_code,
      businessName: sub.business_name,
      settlementBank: sub.settlement_bank,
      accountNumber: sub.account_number,
      percentageCharge: sub.percentage_charge,
      primaryContactEmail: sub.primary_contact_email,
    },
  };
}

/** List subaccounts. */
export async function listSubaccounts(params: {
  perPage?: number;
  page?: number;
} = {}): Promise<{ success: boolean; subaccounts?: Subaccount[]; total?: number; error?: string }> {
  const qs = new URLSearchParams({
    perPage: String(params.perPage ?? 50),
    page: String(params.page ?? 1),
  });
  const data = await paystackFetch<PaystackSubaccountData[]>(`/subaccount?${qs}`);
  if (!data.status) return { success: false, error: data.message };
  const subaccounts: Subaccount[] = (data.data || []).map((sub) => ({
    subaccountCode: sub.subaccount_code,
    businessName: sub.business_name,
    settlementBank: sub.settlement_bank,
    accountNumber: sub.account_number,
    percentageCharge: sub.percentage_charge,
    primaryContactEmail: sub.primary_contact_email,
  }));
  return { success: true, subaccounts, total: data.meta?.total };
}

// ─── Plans & Subscriptions ────────────────────────────────────────────────────

export interface Plan {
  planCode: string;
  name: string;
  interval: string;
  amount: number;
  currency: string;
}

export interface Subscription {
  subscriptionCode: string;
  emailToken: string;
  status: string;
  planCode: string;
  customerEmail: string;
  nextPaymentDate?: string;
}

/** Create a recurring payment plan. */
export async function createPlan(params: {
  name: string;
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'biannually' | 'annually';
  amount: number;  // major units (naira)
  currency?: string;
  description?: string;
}): Promise<{ success: boolean; plan?: Plan; error?: string }> {
  const data = await paystackFetch<PaystackPlanData>('/plan', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      interval: params.interval,
      amount: Math.round(params.amount * 100), // kobo
      currency: params.currency ?? 'NGN',
      description: params.description,
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  const plan = data.data;
  return {
    success: true,
    plan: {
      planCode: plan.plan_code,
      name: plan.name,
      interval: plan.interval,
      amount: plan.amount / 100,
      currency: plan.currency,
    },
  };
}

/** Subscribe a customer to a plan. */
export async function createSubscription(params: {
  customerEmail: string;
  planCode: string;
  startDate?: string; // ISO date
}): Promise<{ success: boolean; subscription?: Subscription; error?: string }> {
  const data = await paystackFetch<PaystackSubscriptionData>('/subscription', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerEmail,
      plan: params.planCode,
      start_date: params.startDate,
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  const sub = data.data;
  return {
    success: true,
    subscription: {
      subscriptionCode: sub.subscription_code,
      emailToken: sub.email_token,
      status: sub.status,
      planCode: params.planCode,
      customerEmail: params.customerEmail,
      nextPaymentDate: sub.next_payment_date,
    },
  };
}

/** Cancel an active subscription. */
export async function cancelSubscription(params: {
  subscriptionCode: string;
  emailToken: string;
}): Promise<{ success: boolean; error?: string }> {
  const data = await paystackFetch('/subscription/disable', {
    method: 'POST',
    body: JSON.stringify({
      code: params.subscriptionCode,
      token: params.emailToken,
    }),
  });
  return { success: data.status === true, error: data.status ? undefined : data.message };
}

/** Fetch a subscription by code. */
export async function fetchSubscription(
  subscriptionCode: string
): Promise<{ success: boolean; subscription?: Subscription; error?: string }> {
  const data = await paystackFetch<PaystackSubscriptionData>(`/subscription/${subscriptionCode}`);
  if (!data.status) return { success: false, error: data.message };
  const sub = data.data;
  return {
    success: true,
    subscription: {
      subscriptionCode: sub.subscription_code,
      emailToken: sub.email_token,
      status: sub.status,
      planCode: sub.plan?.plan_code,
      customerEmail: sub.customer?.email,
      nextPaymentDate: sub.next_payment_date,
    },
  };
}

// ─── Transactions ─────────────────────────────────────────────────────────────

interface PaystackInitData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * Starts a checkout the customer completes in their browser.
 *
 * `amountMinor` is in the currency's smallest unit — kobo for NGN — and is
 * passed through untouched. Callers do the conversion so the unit is explicit
 * at the point where the money is decided, not buried here.
 */
export async function initializeTransaction(params: {
  email: string;
  amountMinor: number;
  reference: string;
  currency?: string;
  callbackUrl?: string;
  channels?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; authorizationUrl?: string; accessCode?: string; error?: string }> {
  const data = await paystackFetch<PaystackInitData>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinor,
      reference: params.reference,
      currency: params.currency ?? 'NGN',
      callback_url: params.callbackUrl,
      channels: params.channels,
      metadata: params.metadata ?? {},
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  return {
    success: true,
    authorizationUrl: data.data?.authorization_url,
    accessCode: data.data?.access_code,
  };
}

interface PaystackChargeData {
  status: string;
  reference: string;
  amount: number;
  gateway_response?: string;
}

/**
 * Charges a saved card without the customer present.
 *
 * Paystack only honours this for authorizations whose `reusable` flag is true,
 * and only with the email the authorization was created with — sending any
 * other email is rejected, so the email must be stored alongside the code
 * rather than re-derived from the tenant later.
 *
 * A `success: true` here means the API call succeeded, NOT that money moved:
 * a declined card returns HTTP 200 with data.status 'failed'. Callers must
 * check `chargeStatus`.
 */
export async function chargeAuthorization(params: {
  authorizationCode: string;
  email: string;
  amountMinor: number;
  reference: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  chargeStatus?: string;
  reference?: string;
  gatewayResponse?: string;
  error?: string;
}> {
  const data = await paystackFetch<PaystackChargeData>('/transaction/charge_authorization', {
    method: 'POST',
    body: JSON.stringify({
      authorization_code: params.authorizationCode,
      email: params.email,
      amount: params.amountMinor,
      reference: params.reference,
      currency: params.currency ?? 'NGN',
      metadata: params.metadata ?? {},
    }),
  });
  if (!data.status) return { success: false, error: data.message };
  return {
    success: true,
    chargeStatus: data.data?.status,
    reference: data.data?.reference,
    gatewayResponse: data.data?.gateway_response,
  };
}
