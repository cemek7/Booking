"use client";
import { useState, useEffect } from 'react';
import { FormSection } from './FormSection';
import { toast } from '../ui/toast';

interface Bank { name: string; code: string; slug: string; }
interface Policy { code: string; version: number; basisPoints: number; capMinor: number | null; }
interface Example { amountMinor: number; platformFeeMinor: number; tenantGrossMinor: number; }
interface Account { bankCode: string; accountLast4: string; accountName: string; }

interface Props { tenantId: string; }

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
const formatMinor = (minor: number) => naira.format(minor / 100);

function statusLabel(status: string | null): string {
  switch (status) {
    case 'active': return 'Active';
    case 'pending': return 'Pending verification';
    case 'invalid':
    case 'suspended': return 'Needs attention';
    default: return 'Setup needed';
  }
}

export function PaymentSettingsSection({ tenantId }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [example, setExample] = useState<Example | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);

  // form fields (the full account number lives only in this input, never in loaded state)
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  const configured = status === 'active';

  useEffect(() => {
    Promise.all([
      fetch('/api/payments/subaccounts').then(r => r.json()),
      fetch('/api/payments/banks').then(r => r.json()),
    ]).then(([subRes, bankRes]) => {
      setStatus(subRes.status ?? null);
      setAccount(subRes.account ?? null);
      setPolicy(subRes.policy ?? null);
      setExample(subRes.example ?? null);
      if (subRes.account?.bankCode) setBankCode(subRes.account.bankCode);
      if (bankRes.banks) setBanks(bankRes.banks);
    }).catch(() => {
      toast.error('Failed to load payment settings');
    }).finally(() => setLoadingInit(false));
  }, [tenantId]);

  async function handleVerify() {
    if (!accountNumber || !bankCode) {
      toast.error('Select a bank and enter an account number first');
      return;
    }
    setVerifying(true);
    setAccountName('');
    try {
      const res = await fetch(`/api/payments/banks/resolve?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verification failed');
      setAccountName(json.accountName);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Account verification failed');
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    if (!policy || !accepted) return;
    if (!bankCode || !accountNumber || !contactEmail || (!configured && !businessName)) {
      toast.error('All fields are required');
      return;
    }
    setSaving(true);
    try {
      const method = configured ? 'PUT' : 'POST';
      const common = { settlementBank: bankCode, accountNumber, primaryContactEmail: contactEmail, acceptPolicy: { code: policy.code, version: policy.version } };
      const body = configured ? common : { businessName, ...common };

      const res = await fetch('/api/payments/subaccounts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');

      setStatus(json.status ?? 'active');
      setAccount(json.account ?? null);
      setAccountNumber('');
      setAccountName('');
      setAccepted(false);
      toast.success('Payment details saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save payment details');
    } finally {
      setSaving(false);
    }
  }

  if (loadingInit) return <div className="text-sm text-gray-500">Loading payment settings…</div>;

  const feePercent = policy ? policy.basisPoints / 100 : null;
  const canSave = accepted && !saving && Boolean(policy);

  return (
    <div className="space-y-6">
      <FormSection title="Current Setup">
        <div className="rounded border px-3 py-2 text-sm space-y-1">
          <p className="font-medium" data-testid="settlement-status">{statusLabel(status)}</p>
          {account && (
            <p className="text-gray-700">{account.accountName} · ****{account.accountLast4}</p>
          )}
          {!configured && (
            <p className="text-xs text-amber-700" data-testid="collection-disabled-warning">
              You can't collect customer payments until setup is active.
            </p>
          )}
        </div>
      </FormSection>

      {policy && (
        <FormSection title="Fees" description="Review these before you save. You must accept the Booka fee to turn on payments.">
          <div className="text-sm space-y-1">
            <p data-testid="booka-fee">
              Booka fee: {feePercent}% per payment{policy.capMinor !== null ? `, capped at ${formatMinor(policy.capMinor)}` : ''}
            </p>
            <p data-testid="paystack-fee-note">Paystack's processing fee is deducted from your payout.</p>
            {example && (
              <p className="text-gray-600" data-testid="settlement-example">
                On a {formatMinor(example.amountMinor)} payment: Booka fee {formatMinor(example.platformFeeMinor)}, you receive {formatMinor(example.tenantGrossMinor)} before Paystack's fee.
              </p>
            )}
          </div>
        </FormSection>
      )}

      <FormSection
        title="Bank Account"
        description="Customer payments are settled to this account via Paystack."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Bank Name
            <select
              className="border rounded px-2 py-1 text-sm"
              value={bankCode}
              onChange={e => { setBankCode(e.target.value); setAccountName(''); }}
            >
              <option value="">Select bank…</option>
              {banks.map(b => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium">
            Account Number
            <div className="flex gap-2">
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                value={accountNumber}
                onChange={e => { setAccountNumber(e.target.value.replace(/\D/g, '')); setAccountName(''); }}
                placeholder="0123456789"
                maxLength={10}
                inputMode="numeric"
                autoComplete="off"
              />
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="px-3 py-1 rounded border text-xs whitespace-nowrap disabled:opacity-60"
              >{verifying ? 'Verifying…' : 'Verify'}</button>
            </div>
            {accountName && (
              <span className="text-xs text-green-700 mt-1">{accountName}</span>
            )}
          </label>

          {!configured && (
            <label className="flex flex-col gap-1 text-xs font-medium">
              Business Name
              <input
                className="border rounded px-2 py-1 text-sm"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                placeholder="Your business name"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium">
            Contact Email
            <input
              className="border rounded px-2 py-1 text-sm"
              type="email"
              value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
        </div>

        <label className="flex items-start gap-2 pt-2 text-xs">
          <input
            type="checkbox"
            data-testid="accept-policy"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
          />
          <span>I accept Booka's fee on each customer payment, as shown above.</span>
        </label>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`px-4 py-1.5 rounded text-sm border ${!canSave ? 'opacity-60 cursor-not-allowed' : 'bg-indigo-600 text-white border-indigo-600'}`}
          >{saving ? 'Saving…' : 'Save Payment Details'}</button>
        </div>
      </FormSection>
    </div>
  );
}

export default PaymentSettingsSection;
