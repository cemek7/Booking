'use client';

import { useEffect, useState } from 'react';
import { authGet, authPatch } from '@/lib/auth/auth-api-client';
import type { AuditSummary, RequestStatus } from '@/lib/booka/revenue-intake';
import AuditReportPrintView from './AuditReportPrintView';

type RevenueRequest = {
  id: string;
  request_type: 'revenue_pilot' | 'missed_revenue_report';
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  vertical: string;
  other_vertical?: string | null;
  weekly_enquiry_band: string;
  channels: string[];
  average_transaction_value_ngn?: number | string | null;
  consent_to_contact: boolean;
  sample_review_consent: boolean;
  status: RequestStatus;
  qualification_note?: string | null;
  audit_summary?: Partial<AuditSummary> | null;
  created_at: string;
};

type Draft = {
  status: RequestStatus;
  qualificationNote: string;
  audit: AuditSummary;
};

const statuses: RequestStatus[] = [
  'new',
  'qualified',
  'contacted',
  'audit_in_progress',
  'audit_ready',
  'pilot_scheduled',
  'converted',
  'closed',
];

function auditFrom(value: Partial<AuditSummary> | null | undefined): AuditSummary {
  return {
    enquiries_reviewed: Number(value?.enquiries_reviewed ?? 0),
    unanswered_or_delayed: Number(value?.unanswered_or_delayed ?? 0),
    missing_next_step: Number(value?.missing_next_step ?? 0),
    availability_dead_ends: Number(value?.availability_dead_ends ?? 0),
    missing_follow_ups: Number(value?.missing_follow_ups ?? 0),
    missed_recommendations: Number(value?.missed_recommendations ?? 0),
    opportunity_low_ngn: Number(value?.opportunity_low_ngn ?? 0),
    opportunity_high_ngn: Number(value?.opportunity_high_ngn ?? 0),
    assumptions: Array.isArray(value?.assumptions) ? value.assumptions : [],
  };
}

function ngn(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Not supplied';
  return `₦${Number(value).toLocaleString('en-US')}`;
}

export default function RevenueRequestsClient() {
  const [requests, setRequests] = useState<RevenueRequest[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [requestType, setRequestType] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (requestType) params.set('request_type', requestType);
      if (status) params.set('status', status);
      const suffix = params.toString();
      const response = await authGet<{ data: RevenueRequest[]; total: number }>(
        `/api/superadmin/booka-revenue-requests${suffix ? `?${suffix}` : ''}`,
      );

      if (!active) return;
      if (response.error || !response.data) {
        setError(response.error?.message || 'Revenue requests could not be loaded.');
        setRequests([]);
      } else {
        setRequests(response.data.data);
        setDrafts(Object.fromEntries(response.data.data.map((request) => [
          request.id,
          {
            status: request.status,
            qualificationNote: request.qualification_note ?? '',
            audit: auditFrom(request.audit_summary),
          },
        ])));
      }
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [requestType, status]);

  function updateDraft(id: string, updater: (draft: Draft) => Draft) {
    setDrafts((current) => ({ ...current, [id]: updater(current[id]) }));
  }

  async function saveWorkflow(request: RevenueRequest) {
    const draft = drafts[request.id];
    if (!draft) return;
    setNotice('');
    setError('');
    const response = await authPatch(`/api/superadmin/booka-revenue-requests/${request.id}`, {
      status: draft.status,
      qualification_note: draft.qualificationNote,
    });
    if (response.error) setError(response.error.message);
    else setNotice(`${request.business_name} request updated.`);
  }

  async function saveAudit(request: RevenueRequest) {
    const draft = drafts[request.id];
    if (!draft) return;
    setNotice('');
    setError('');
    const response = await authPatch(`/api/superadmin/booka-revenue-requests/${request.id}`, {
      audit_summary: draft.audit,
    });
    if (response.error) setError(response.error.message);
    else setNotice(`${request.business_name} audit report saved.`);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Booka revenue operations</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Pilot and audit requests</h1>
        <p className="mt-2 text-sm text-slate-600">Qualify applicants, move workflow status and prepare privacy-safe reports.</p>
      </header>

      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Request type filter
          <select
            value={requestType}
            onChange={(event) => setRequestType(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
          >
            <option value="">All request types</option>
            <option value="revenue_pilot">Revenue pilot</option>
            <option value="missed_revenue_report">Missed revenue report</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Status filter
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
          >
            <option value="">All statuses</option>
            {statuses.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
      </div>

      {notice ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</p> : null}

      {loading ? <p className="text-sm text-slate-500">Loading revenue requests…</p> : null}
      {!loading && requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No revenue requests match these filters.
        </div>
      ) : null}

      <div className="space-y-6">
        {requests.map((request) => {
          const draft = drafts[request.id];
          if (!draft) return null;
          const canPrint = request.request_type === 'missed_revenue_report' && draft.audit.assumptions.length > 0;

          return (
            <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                    {request.request_type.replaceAll('_', ' ')}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">{request.business_name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {request.contact_name} · {request.email} · {request.phone}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.channels.map((channel) => (
                    <span key={channel} className="rounded-full bg-emerald-50 px-3 py-1 text-xs capitalize text-emerald-800">
                      {channel}
                    </span>
                  ))}
                </div>
              </div>

              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-slate-500">Vertical</dt><dd className="mt-1 font-medium">{request.other_vertical || request.vertical}</dd></div>
                <div><dt className="text-slate-500">Weekly enquiries</dt><dd className="mt-1 font-medium">{request.weekly_enquiry_band.replaceAll('_', '–')}</dd></div>
                <div><dt className="text-slate-500">Average transaction</dt><dd className="mt-1 font-medium">{ngn(request.average_transaction_value_ngn)}</dd></div>
                <div><dt className="text-slate-500">Consent</dt><dd className="mt-1 font-medium">Contact: {request.consent_to_contact ? 'yes' : 'no'} · Sample: {request.sample_review_consent ? 'yes' : 'no'}</dd></div>
              </dl>

              <div className="mt-6 grid gap-4 lg:grid-cols-[0.35fr_0.65fr]">
                <label className="text-sm font-medium text-slate-700">
                  Status for {request.business_name}
                  <select
                    value={draft.status}
                    onChange={(event) => updateDraft(request.id, (current) => ({
                      ...current,
                      status: event.target.value as RequestStatus,
                    }))}
                    className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
                  >
                    {statuses.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Qualification note for {request.business_name}
                  <textarea
                    value={draft.qualificationNote}
                    onChange={(event) => updateDraft(request.id, (current) => ({
                      ...current,
                      qualificationNote: event.target.value,
                    }))}
                    className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void saveWorkflow(request)}
                className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
              >
                Save {request.business_name} request
              </button>

              {request.request_type === 'missed_revenue_report' ? (
                <div className="mt-8 border-t border-slate-200 pt-6">
                  <h3 className="text-lg font-semibold">Audit summary</h3>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {([
                      ['enquiries_reviewed', 'Enquiries reviewed'],
                      ['unanswered_or_delayed', 'Unanswered or delayed'],
                      ['missing_next_step', 'Missing next step'],
                      ['availability_dead_ends', 'Availability dead ends'],
                      ['missing_follow_ups', 'Missing follow-ups'],
                      ['missed_recommendations', 'Missed recommendations'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="text-sm text-slate-700">
                        {label} for {request.business_name}
                        <input
                          type="number"
                          min="0"
                          value={draft.audit[key]}
                          onChange={(event) => updateDraft(request.id, (current) => ({
                            ...current,
                            audit: { ...current.audit, [key]: Number(event.target.value) },
                          }))}
                          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
                        />
                      </label>
                    ))}
                    <label className="text-sm text-slate-700">
                      Opportunity low for {request.business_name}
                      <input
                        type="number"
                        min="0"
                        value={draft.audit.opportunity_low_ngn}
                        onChange={(event) => updateDraft(request.id, (current) => ({
                          ...current,
                          audit: { ...current.audit, opportunity_low_ngn: Number(event.target.value) },
                        }))}
                        className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-700">
                      Opportunity high for {request.business_name}
                      <input
                        type="number"
                        min="0"
                        value={draft.audit.opportunity_high_ngn}
                        onChange={(event) => updateDraft(request.id, (current) => ({
                          ...current,
                          audit: { ...current.audit, opportunity_high_ngn: Number(event.target.value) },
                        }))}
                        className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2"
                      />
                    </label>
                  </div>
                  <label className="mt-4 block text-sm text-slate-700">
                    Assumptions for {request.business_name} (one per line)
                    <textarea
                      value={draft.audit.assumptions.join('\n')}
                      onChange={(event) => updateDraft(request.id, (current) => ({
                        ...current,
                        audit: {
                          ...current.audit,
                          assumptions: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean),
                        },
                      }))}
                      className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveAudit(request)}
                    className="mt-4 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
                  >
                    Save {request.business_name} audit report
                  </button>

                  {canPrint ? (
                    <div className="mt-6">
                      <AuditReportPrintView
                        businessName={request.business_name}
                        createdAt={request.created_at}
                        summary={draft.audit}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
