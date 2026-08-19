"use client";
import { useState, useEffect } from 'react';
import { FormSection } from './FormSection';
import { toast } from '../ui/toast';

interface Bank { name: string; code: string; slug: string; }
interface Subaccount {
  subaccountCode: string;
  businessName: string;
  settlementBank: string;
  accountNumber: string;
  percentageCharge: number;
  primaryContactEmail: string;
}

interface Props { tenantId: string; }

export function PaymentSettingsSection({ tenantId }: Props) {
  const [configured, setConfigured] = useState(false);
  const [subaccount, setSubaccount] = useState<Subaccount | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);

  // form fields
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/payments/subaccounts').then(r => r.json()),
      fetch('/api/payments/banks').then(r => r.json()),
    ]).then(([subRes, bankRes]) => {
      if (subRes.configured && subRes.subaccount) {
        setConfigured(true);
        setSubaccount(subRes.subaccount);
        setBankCode(subRes.subaccount.settlementBank);
        setAccountNumber(subRes.subaccount.accountNumber);
        setBusinessName(subRes.subaccount.businessName);
        setContactEmail(subRes.subaccount.primaryContactEmail);
      }
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
      const res = await fetch(`/api/payments/banks/resolve?accountNumber=${accountNumber}&bankCode=${bankCode}`);
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
    if (!bankCode || !accountNumber || !businessName || !contactEmail) {
      toast.error('All fields are required');
      return;
    }
    setSaving(true);
    try {
      const method = configured ? 'PUT' : 'POST';
      const body = configured
        ? { settlementBank: bankCode, accountNumber, primaryContactEmail: contactEmail }
        : { businessName, settlementBank: bankCode, accountNumber, primaryContactEmail: contactEmail };

      const res = await fetch('/api/payments/subaccounts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');

      setConfigured(true);
      setSubaccount(json.subaccount);
      toast.success('Payment details saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save payment details');
    } finally {
      setSaving(false);
    }
  }

  if (loadingInit) return <div className="text-sm text-gray-500">Loading payment settings…</div>;

  const tenantShare = subaccount ? (100 - subaccount.percentageCharge) : null;

  return (
    <div className="space-y-6">
      {configured && subaccount && (
        <FormSection title="Current Setup">
          <div className="rounded border bg-green-50 px-3 py-2 text-sm space-y-1">
            <p className="font-medium text-green-800">Configured</p>
            <p className="text-gray-700">{subaccount.businessName} · ****{subaccount.accountNumber.slice(-4)}</p>
            <p className="text-xs text-gray-500">Percentage going to you: {tenantShare}%</p>
          </div>
        </FormSection>
      )}

      <FormSection
        title="Bank Account"
        description="Revenue from bookings will be automatically settled to this account via Paystack split payment."
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
                onChange={e => { setAccountNumber(e.target.value); setAccountName(''); }}
                placeholder="0123456789"
                maxLength={10}
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

          <label className="flex flex-col gap-1 text-xs font-medium">
            Business Name
            <input
              className="border rounded px-2 py-1 text-sm"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              placeholder="Your business name"
            />
          </label>

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

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-1.5 rounded text-sm border ${saving ? 'opacity-60 cursor-not-allowed' : 'bg-indigo-600 text-white border-indigo-600'}`}
          >{saving ? 'Saving…' : 'Save Payment Details'}</button>
        </div>
      </FormSection>
    </div>
  );
}

export default PaymentSettingsSection;
