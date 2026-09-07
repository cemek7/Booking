'use client';

import { FormEvent, useState } from 'react';

type RequestType = 'revenue_pilot' | 'missed_revenue_report';
type SubmitState = 'idle' | 'pending' | 'success' | 'error';

type FormState = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  vertical: 'beauty' | 'hospitality' | 'clinic' | 'other';
  otherVertical: string;
  weeklyEnquiryBand: string;
  channels: Array<'whatsapp' | 'instagram'>;
  averageTransactionValue: string;
  currentConversionBand: string;
  instagramHandle: string;
  websiteUrl: string;
  consentToContact: boolean;
  sampleReviewConsent: boolean;
  companyWebsite: string;
};

const initialState: FormState = {
  businessName: '',
  contactName: '',
  email: '',
  phone: '',
  vertical: 'beauty',
  otherVertical: '',
  weeklyEnquiryBand: '',
  channels: [],
  averageTransactionValue: '',
  currentConversionBand: '',
  instagramHandle: '',
  websiteUrl: '',
  consentToContact: false,
  sampleReviewConsent: false,
  companyWebsite: '',
};

const inputClass =
  'mt-2 w-full rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-[#10211a] outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100/70';

function responseMessage(body: unknown) {
  if (!body || typeof body !== 'object') return 'We could not save your request. Please try again.';
  if ('message' in body && typeof body.message === 'string') return body.message;
  if (
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return 'We could not save your request. Please try again.';
}

export default function RevenueRequestForm({ requestType }: { requestType: RequestType }) {
  const [form, setForm] = useState<FormState>(initialState);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  const isPilot = requestType === 'revenue_pilot';

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleChannel(channel: 'whatsapp' | 'instagram') {
    setForm((current) => ({
      ...current,
      channels: current.channels.includes(channel)
        ? current.channels.filter((item) => item !== channel)
        : [...current.channels, channel],
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!form.consentToContact) {
      setSubmitState('error');
      setError('Please provide consent to contact you about this request.');
      return;
    }
    if (form.channels.length === 0) {
      setSubmitState('error');
      setError('Select at least one customer enquiry channel.');
      return;
    }
    if (form.vertical === 'other' && form.otherVertical.trim().length === 0) {
      setSubmitState('error');
      setError('Please describe your business type.');
      return;
    }

    setSubmitState('pending');

    try {
      const response = await fetch('/api/public/booka/revenue-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_type: requestType,
          business_name: form.businessName,
          contact_name: form.contactName,
          email: form.email,
          phone: form.phone,
          vertical: form.vertical,
          other_vertical: form.vertical === 'other' ? form.otherVertical : undefined,
          weekly_enquiry_band: form.weeklyEnquiryBand,
          channels: form.channels,
          average_transaction_value_ngn: form.averageTransactionValue
            ? Number(form.averageTransactionValue)
            : undefined,
          current_conversion_band: form.currentConversionBand || undefined,
          instagram_handle: form.instagramHandle || undefined,
          website_url: form.websiteUrl || undefined,
          consent_to_contact: form.consentToContact,
          sample_review_consent: form.sampleReviewConsent,
          company_website: form.companyWebsite,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body));

      setSubmitState('success');
    } catch (submitError) {
      setSubmitState('error');
      setError(submitError instanceof Error ? submitError.message : 'We could not save your request.');
    }
  }

  if (submitState === 'success') {
    return (
      <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-6 shadow-sm" role="status">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700/60">Request received</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#10211a]">
          {isPilot ? 'Your application is in the review queue.' : 'Your report request is in the review queue.'}
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          {isPilot
            ? 'Booka will review your enquiry volume, channels and operating readiness, then contact you about fit and the live-channel setup.'
            : 'Booka will contact you to agree a consented, minimized sample and a privacy-safe handoff. Do not send customer messages until that process is agreed.'}
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="rounded-[2rem] border border-emerald-100 bg-white p-5 shadow-sm sm:p-7">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Business name
          <input
            required
            className={inputClass}
            value={form.businessName}
            onChange={(event) => update('businessName', event.target.value)}
            autoComplete="organization"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Contact name
          <input
            required
            className={inputClass}
            value={form.contactName}
            onChange={(event) => update('contactName', event.target.value)}
            autoComplete="name"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Email
          <input
            required
            type="email"
            className={inputClass}
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Phone
          <input
            required
            type="tel"
            className={inputClass}
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            autoComplete="tel"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Business type
          <select
            className={inputClass}
            value={form.vertical}
            onChange={(event) => update('vertical', event.target.value as FormState['vertical'])}
          >
            <option value="beauty">Beauty, wellness or personal care</option>
            <option value="hospitality">Hospitality, food or events</option>
            <option value="clinic">Clinic, diagnostics or health practice</option>
            <option value="other">Another service or commerce business</option>
          </select>
        </label>
        {form.vertical === 'other' ? (
          <label className="text-sm font-medium text-slate-700">
            Describe your business type
            <input
              required
              className={inputClass}
              value={form.otherVertical}
              onChange={(event) => update('otherVertical', event.target.value)}
            />
          </label>
        ) : null}
        <label className="text-sm font-medium text-slate-700">
          Weekly enquiries
          <select
            required
            className={inputClass}
            value={form.weeklyEnquiryBand}
            onChange={(event) => update('weeklyEnquiryBand', event.target.value)}
          >
            <option value="">Select a range</option>
            <option value="under_20">Under 20</option>
            <option value="20_49">20–49</option>
            <option value="50_99">50–99</option>
            <option value="100_249">100–249</option>
            <option value="250_plus">250+</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Average transaction value (NGN, optional)
          <input
            type="number"
            min="1"
            inputMode="decimal"
            className={inputClass}
            value={form.averageTransactionValue}
            onChange={(event) => update('averageTransactionValue', event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Current enquiry conversion (optional)
          <select
            className={inputClass}
            value={form.currentConversionBand}
            onChange={(event) => update('currentConversionBand', event.target.value)}
          >
            <option value="">Select if known</option>
            <option value="unknown">Unknown</option>
            <option value="under_10">Under 10%</option>
            <option value="10_24">10–24%</option>
            <option value="25_49">25–49%</option>
            <option value="50_plus">50%+</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Instagram handle (optional)
          <input
            className={inputClass}
            value={form.instagramHandle}
            onChange={(event) => update('instagramHandle', event.target.value)}
            placeholder="@yourbusiness"
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Website URL (optional)
          <input
            type="url"
            className={inputClass}
            value={form.websiteUrl}
            onChange={(event) => update('websiteUrl', event.target.value)}
            placeholder="https://"
          />
        </label>
      </div>

      <fieldset className="mt-6 rounded-3xl border border-emerald-100 bg-emerald-50/50 p-5">
        <legend className="px-1 text-sm font-semibold text-[#10211a]">Where customers enquire</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {(['whatsapp', 'instagram'] as const).map((channel) => (
            <label key={channel} className="flex items-center gap-2 text-sm capitalize text-slate-700">
              <input
                type="checkbox"
                checked={form.channels.includes(channel)}
                onChange={() => toggleChannel(channel)}
                className="h-4 w-4 accent-emerald-600"
              />
              {channel}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 space-y-4">
        <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
          <input
            required
            type="checkbox"
            checked={form.consentToContact}
            onChange={(event) => update('consentToContact', event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
          />
          I consent to Booka contacting me about this request and the information supplied here.
        </label>
        <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
          <input
            type="checkbox"
            checked={form.sampleReviewConsent}
            onChange={(event) => update('sampleReviewConsent', event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
          />
          I am open to a separately agreed review of a consented, minimized enquiry sample. I understand this form
          does not collect customer conversations.
        </label>
      </div>

      <div className="hidden" aria-hidden="true">
        <label>
          Company website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.companyWebsite}
            onChange={(event) => update('companyWebsite', event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitState === 'pending'}
        className="mt-6 w-full rounded-full bg-emerald-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
      >
        {submitState === 'pending'
          ? 'Submitting…'
          : isPilot
            ? 'Apply for the Revenue Pilot'
            : 'Request the Missed Revenue Report'}
      </button>
    </form>
  );
}
