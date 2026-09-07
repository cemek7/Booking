"use client";

import { CheckCircle2, Clock3, Send, Sparkles, X } from 'lucide-react';

export type DailyOperatingLoopView = {
  state: 'setup' | 'active' | 'clear';
  automationPaused: boolean;
  primaryObjective: {
    id: string;
    title: string;
    explanation: string;
  } | null;
  supportingSignals: unknown[];
};

export type DailyOperatingLoopAction = 'execute' | 'defer' | 'dismiss';

export function DailyOperatingLoop({
  enabled,
  loop,
  onAction,
}: {
  enabled: boolean;
  loop: DailyOperatingLoopView;
  onAction: (action: DailyOperatingLoopAction, objectiveId: string) => void;
}) {
  if (!enabled) return null;

  const objective = loop.primaryObjective;
  const signals = loop.supportingSignals.slice(0, 3).map(String);

  return (
    <section aria-labelledby="daily-operating-loop-title" className="overflow-hidden rounded-3xl border border-emerald-200 bg-[linear-gradient(120deg,#062d26_0%,#0a4539_56%,#0d5a46_100%)] text-white shadow-[0_18px_50px_-28px_rgba(6,45,38,0.85)]">
      <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Today’s Front Desk
          </div>
          {objective ? (
            <>
              <h2 id="daily-operating-loop-title" className="mt-4 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">{objective.title}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/80">{objective.explanation}</p>
              {loop.automationPaused && <p className="mt-3 text-sm font-medium text-amber-200">Automation is paused. Review this before sending anything.</p>}
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button type="button" disabled={loop.automationPaused} onClick={() => onAction('execute', objective.id)} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-[#06352a] transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <Send className="h-4 w-4" aria-hidden="true" /> Let Booka handle it
                </button>
                <button type="button" onClick={() => onAction('defer', objective.id)} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15">
                  <Clock3 className="h-4 w-4" aria-hidden="true" /> Remind me later
                </button>
                <button type="button" onClick={() => onAction('dismiss', objective.id)} className="inline-flex items-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium text-emerald-100 transition hover:bg-white/10">
                  <X className="h-4 w-4" aria-hidden="true" /> Not relevant
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="daily-operating-loop-title" className="mt-4 text-2xl font-semibold tracking-tight">Today’s front desk is clear.</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-50/80">Booka will surface the next customer or revenue risk that needs attention.</p>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-200">Quiet progress</p>
          <ul className="mt-3 space-y-2.5">
            {signals.length ? signals.map((signal) => <li key={signal} className="flex gap-2 text-sm leading-5 text-emerald-50"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />{signal}</li>) : <li className="text-sm leading-5 text-emerald-100/70">No open operational signals.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
