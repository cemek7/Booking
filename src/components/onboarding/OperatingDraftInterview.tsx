'use client';

import { useState } from 'react';
import {
  OPERATING_DRAFT_QUESTIONS,
  type OnboardingEvidenceSourceType,
  type OperatingDraftQuestionId,
  type OperatingDraftView,
} from '@/lib/onboarding/operating-draft';

export type OperatingDraftInterviewAction =
  | { action: 'answer'; questionId: OperatingDraftQuestionId; answer: string }
  | { action: 'skip'; questionId: OperatingDraftQuestionId }
  | { action: 'add_source'; sourceType: Exclude<OnboardingEvidenceSourceType, 'owner_answer'>; sourceReference: string }
  | { action: 'approve' };

interface OperatingDraftInterviewProps {
  enabled: boolean;
  draft: OperatingDraftView | null;
  onAction: (action: OperatingDraftInterviewAction) => Promise<void>;
  onContinue: () => void;
}

const sourceOptions: Array<{ value: Exclude<OnboardingEvidenceSourceType, 'owner_answer'>; label: string }> = [
  { value: 'website', label: 'Website' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google_listing', label: 'Google listing' },
  { value: 'whatsapp_export', label: 'WhatsApp export' },
  { value: 'price_list', label: 'Price list' },
  { value: 'other', label: 'Other source' },
];

export default function OperatingDraftInterview({ enabled, draft, onAction, onContinue }: OperatingDraftInterviewProps) {
  const [answer, setAnswer] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [sourceType, setSourceType] = useState<Exclude<OnboardingEvidenceSourceType, 'owner_answer'>>('website');
  const [reviewQuestionId, setReviewQuestionId] = useState<OperatingDraftQuestionId | null>(null);
  const [saving, setSaving] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  if (!enabled || !draft) return null;

  const question = draft.nextQuestion ?? (reviewQuestionId
    ? OPERATING_DRAFT_QUESTIONS.find((candidate) => candidate.id === reviewQuestionId) ?? null
    : null);
  const canApprove = draft.readiness.answered === draft.readiness.total && !draft.launch.ready;

  async function submit(action: OperatingDraftInterviewAction) {
    setSaving(true);
    setSubmissionError(null);
    try {
      await onAction(action);
      setAnswer('');
      setSourceReference('');
      setReviewQuestionId(null);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Unable to save your front-desk setup');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5" aria-label="Front-desk interview">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/70">A short front-desk interview</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Let&apos;s make Booka sound like your business.
        </h2>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          I&apos;ll ask one practical question at a time, then show you exactly what Booka will use. Nothing is sent or automated until you approve it.
        </p>
      </div>

      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-semibold text-emerald-950">{draft.readiness.answered} of {draft.readiness.total} front-desk details ready</span>
          <span className="text-emerald-800">{draft.readiness.percent}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${draft.readiness.percent}%` }} />
        </div>
      </div>

      {submissionError && (
        <p role="alert" className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
          {submissionError}
        </p>
      )}

      {question ? (
        <div className="space-y-4 rounded-[1.6rem] border border-[var(--brand-line)] bg-[#fcfbf7] p-5">
          <p className="text-base font-semibold leading-7 text-[var(--brand-ink)]">{question.prompt}</p>
          <label className="block text-sm font-medium text-slate-700" htmlFor="operating-draft-answer">Your answer</label>
          <textarea
            id="operating-draft-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="min-h-28 w-full resize-y rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            placeholder="Write it how you would explain it to a trusted front-desk teammate."
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving || answer.trim().length < 2}
              onClick={() => void submit({ action: 'answer', questionId: question.id, answer: answer.trim() })}
              className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save answer
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit({ action: 'skip', questionId: question.id })}
              className="rounded-full border border-[var(--brand-line)] bg-white px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:border-emerald-200 hover:text-emerald-900 disabled:opacity-50"
            >
              Skip for now
            </button>
            {reviewQuestionId && (
              <button type="button" onClick={() => setReviewQuestionId(null)} className="px-2 text-sm text-slate-500 hover:text-slate-800">
                Back to summary
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-[1.6rem] border border-[var(--brand-line)] bg-[#fcfbf7] p-5">
          <div>
            <h3 className="text-lg font-semibold text-[var(--brand-ink)]">Review your front-desk setup</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">This is the operating brief Booka will follow. Review it before any launch decision.</p>
          </div>
          <dl className="space-y-3">
            {OPERATING_DRAFT_QUESTIONS.map((item) => {
              const value = draft.answers[item.id];
              return (
                <div key={item.id} className="rounded-2xl border border-white bg-white px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.prompt}</dt>
                  <dd className="mt-2 text-sm leading-6 text-slate-700">
                    {value.status === 'answered' ? value.answer : 'Skipped — Booka will wait for your answer.'}
                  </dd>
                  {value.status === 'skipped' && (
                    <button type="button" className="mt-2 text-sm font-medium text-emerald-700 hover:text-emerald-900" onClick={() => setReviewQuestionId(item.id)}>
                      Answer this now
                    </button>
                  )}
                </div>
              );
            })}
          </dl>
          {draft.launch.ready ? (
            <button type="button" onClick={onContinue} className="w-full rounded-full bg-emerald-600 py-3 text-sm font-medium text-white transition hover:bg-emerald-700">
              Continue to Booka
            </button>
          ) : canApprove ? (
            <button type="button" disabled={saving} onClick={() => void submit({ action: 'approve' })} className="w-full rounded-full bg-emerald-600 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50">
              Approve front-desk setup
            </button>
          ) : (
            <p className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              Add answers to skipped details before Booka can be approved for launch.
            </p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-[var(--brand-line)] bg-white p-4">
        <label htmlFor="operating-draft-source" className="text-sm font-medium text-[var(--brand-ink)]">Give Booka a source to investigate (optional)</label>
        <p className="mt-1 text-xs leading-5 text-slate-500">A website, Instagram profile, Google listing, WhatsApp export, or price list stays draft-only until you review it.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select aria-label="Source type" value={sourceType} onChange={(event) => setSourceType(event.target.value as Exclude<OnboardingEvidenceSourceType, 'owner_answer'>)} className="rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-700">
            {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input id="operating-draft-source" value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="https://… or a file reference" className="min-w-0 flex-1 rounded-xl border border-[var(--brand-line)] px-3 py-2 text-sm outline-none focus:border-emerald-300" />
          <button type="button" disabled={saving || !sourceReference.trim()} onClick={() => void submit({ action: 'add_source', sourceType, sourceReference: sourceReference.trim() })} className="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50">Save source</button>
        </div>
      </div>

      {!draft.launch.ready && (
        <button type="button" onClick={onContinue} className="w-full py-2 text-sm text-slate-500 transition hover:text-slate-800">
          Finish this later
        </button>
      )}
    </section>
  );
}
