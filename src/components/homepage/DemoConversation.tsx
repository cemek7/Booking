'use client';

import { useEffect, useRef, useState } from 'react';

type Speaker = 'user' | 'booka';

type DemoMessage = {
  id: string;
  speaker: Speaker;
  text: string;
};

const steps = [
  {
    key: 'service',
    prompt: 'What would you like to book?',
    options: ['Hair appointment', 'Clinic consultation', 'Dinner reservation'],
  },
  {
    key: 'date',
    prompt: 'Which day works best?',
    options: ['Friday', 'Saturday', 'Monday'],
  },
  {
    key: 'time',
    prompt: 'Pick a time slot.',
    options: ['9:00am', '10:30am', '1:00pm'],
  },
  {
    key: 'name',
    prompt: 'What name should I put the booking under?',
    options: ['Amina', 'Tunde', 'Blessing'],
  },
  {
    key: 'phone',
    prompt: 'What number should I use for the reminder?',
    options: ['+234 801 234 5678', '+234 803 111 2244', '+234 812 900 4455'],
  },
] as const;

const greeting = {
  id: 'welcome',
  speaker: 'booka' as const,
  text: 'Hi, welcome to Booka. I can help you book an appointment or reservation in a few taps. What would you like to book?',
};

function bookingSummary(selection: Record<string, string>) {
  return [
    `Service: ${selection.service}`,
    `Date: ${selection.date}`,
    `Time: ${selection.time}`,
    `Name: ${selection.name}`,
    `Phone: ${selection.phone}`,
  ].join('\n');
}

export default function DemoConversation() {
  const [messages, setMessages] = useState<DemoMessage[]>([greeting]);
  const [typing, setTyping] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const selection: Record<string, string> = {};

    const clearTimers = () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };

    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        timersRef.current.push(timer);
      });

    const run = async () => {
      clearTimers();
      setMessages([greeting]);
      setTyping(false);
      setActiveStep(0);
      await delay(700);
      if (cancelled) return;

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const choice = step.options[index % step.options.length];
        const nextStep = steps[index + 1];

        setActiveStep(index);
        setTyping(true);
        await delay(700);
        if (cancelled) return;

        selection[step.key] = choice;
        setMessages((current) => [
          ...current,
          { id: `${Date.now()}-${step.key}-user`, speaker: 'user', text: choice },
        ]);

        setTyping(false);
        await delay(500);
        if (cancelled) return;

        if (nextStep) {
          setMessages((current) => [
            ...current,
            { id: `${Date.now()}-${step.key}-booka`, speaker: 'booka', text: nextStep.prompt },
          ]);
        } else {
          setMessages((current) => [
            ...current,
            {
              id: `${Date.now()}-${step.key}-booka`,
              speaker: 'booka',
              text: `Thanks. Here’s the booking summary:\n${bookingSummary(selection)}\n\nI’ve reserved the slot and set a reminder for you.`,
            },
          ]);
        }

        await delay(700);
        if (cancelled) return;
      }

      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-wrap`,
          speaker: 'booka',
          text: 'Want me to book another slot?',
        },
      ]);

      await delay(1800);
      if (cancelled) return;

      void run();
    };

    void run();

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, typing]);

  const currentOptions = steps[Math.min(activeStep, steps.length - 1)]?.options ?? [];

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-emerald-100 bg-white p-5 shadow-[0_25px_80px_rgba(16,33,26,0.08)]">
      <div className="flex items-center justify-between border-b border-emerald-100 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-700/45">Live demo</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#10211a]">
            Book like a real customer
          </h2>
        </div>
        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
          Managed
        </div>
      </div>

      <div className="relative mt-5 overflow-hidden rounded-[1.5rem] bg-emerald-50/60">
        <div
          ref={scrollRef}
          className="max-h-[22rem] space-y-3 overflow-y-auto px-4 py-4 pr-2 [scrollbar-width:thin]"
        >
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={
                  message.speaker === 'user'
                    ? 'max-w-[18rem] whitespace-pre-line rounded-3xl rounded-tr-sm bg-emerald-600 px-4 py-3 text-sm leading-6 text-white shadow-sm'
                    : 'max-w-[18rem] whitespace-pre-line rounded-3xl rounded-tl-sm border border-emerald-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm'
                }
              >
                {message.text}
              </div>
            </div>
          ))}

          {typing ? (
            <div className="flex justify-start">
              <div className="rounded-3xl rounded-tl-sm border border-emerald-100 bg-white px-4 py-3 text-sm leading-6 text-slate-500 shadow-sm">
                Booka is checking availability...
              </div>
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-emerald-50/95 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-emerald-50/95 to-transparent" />
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {currentOptions.map((option) => (
          <div
            key={option}
            className="rounded-full border border-emerald-100 bg-white px-3 py-3 text-xs font-medium text-slate-600 shadow-sm"
          >
            {option}
          </div>
        ))}
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-medium text-emerald-800 shadow-sm sm:col-span-3">
          Booking complete. Starting another intake automatically.
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-xs uppercase tracking-[0.22em] text-emerald-700/45">What it handles</div>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Booking intake, reminders, follow-up, reactivation, and escalation when the request needs a person.
          </p>
        </div>
        <div className="rounded-3xl border border-emerald-100 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.22em] text-emerald-700/45">What gets measured</div>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            No-shows, repeat bookings, recovered revenue, and the results of every campaign.
          </p>
        </div>
      </div>
    </div>
  );
}
