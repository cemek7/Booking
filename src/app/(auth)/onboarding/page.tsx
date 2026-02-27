"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';

interface ServiceDraft { name: string; duration: string; price: string }
interface StaffDraft { name: string; email: string; role: 'owner' | 'staff' }
interface FaqDraft { question: string; answer: string; category: string }

type Step = 'basics' | 'services' | 'staff' | 'faqs' | 'done';
const STEPS: Step[] = ['basics', 'services', 'staff', 'faqs', 'done'];
const STEP_LABELS: Record<Step, string> = {
  basics: 'Your Business',
  services: 'Services',
  staff: 'Team',
  faqs: 'Knowledge Base',
  done: 'All Done',
};

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEPS.indexOf(current);
  const visible = STEPS.filter((s) => s !== 'done');
  return (
    <div className="flex items-center gap-1 mb-6">
      {visible.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
              i < currentIdx
                ? 'bg-indigo-600 text-white'
                : i === currentIdx
                ? 'border-2 border-indigo-600 text-indigo-600'
                : 'border-2 border-gray-200 text-gray-400'
            }`}
          >
            {i < currentIdx ? '✓' : i + 1}
          </div>
          <span
            className={`text-xs hidden sm:inline ${
              i === currentIdx ? 'text-indigo-600 font-medium' : 'text-gray-400'
            }`}
          >
            {STEP_LABELS[step]}
          </span>
          {i < visible.length - 1 && (
            <div className={`w-6 h-0.5 mx-1 ${i < currentIdx ? 'bg-indigo-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('basics');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [description, setDescription] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [services, setServices] = useState<ServiceDraft[]>([{ name: '', duration: '', price: '' }]);
  const [staffList, setStaffList] = useState<StaffDraft[]>([{ name: '', email: '', role: 'staff' }]);
  const [faqs, setFaqs] = useState<FaqDraft[]>([{ question: '', answer: '', category: '' }]);
  const [loading, setLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  function next() {
    setStep((s) => STEPS[Math.min(STEPS.indexOf(s) + 1, STEPS.length - 1)]);
  }
  function back() {
    setStep((s) => STEPS[Math.max(STEPS.indexOf(s) - 1, 0)]);
  }

  async function submitBasics() {
    if (!name.trim()) { toast.error('Business name is required'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/onboarding/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          timezone: timezone.trim() || undefined,
          description: description.trim() || undefined,
          business_type: businessType || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string })?.error || 'Failed to create tenant');
        return;
      }
      const json = await res.json() as { tenantId?: string; tenantSlug?: string };
      if (json?.tenantId) {
        setTenantId(json.tenantId);
        if (json.tenantSlug) setTenantSlug(json.tenantSlug);
        try { localStorage.setItem('current_tenant', JSON.stringify({ id: json.tenantId })); } catch {}
      }
      next();
    } catch { toast.error('Network error'); }
    finally { setLoading(false); }
  }

  async function submitServices() {
    const valid = services.filter((s) => s.name.trim());
    if (valid.length > 0 && tenantId) {
      setLoading(true);
      let hadError = false;
      try {
        await Promise.all(
          valid.map((s) =>
            fetch('/api/services', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
              body: JSON.stringify({
                name: s.name.trim(),
                duration: s.duration ? Number(s.duration) : undefined,
                price: s.price ? Number(s.price) : undefined,
              }),
            })
          )
        );
      } catch {
        hadError = true;
        toast.error('Some services could not be saved — you can add them later in the dashboard.');
      } finally { setLoading(false); }
      if (hadError) return; // stay on step so user can retry or use "Skip for now"
    }
    next();
  }

  async function submitStaff() {
    const valid = staffList.filter((s) => s.name.trim() || s.email.trim());
    if (valid.length > 0 && tenantId) {
      setLoading(true);
      let hadError = false;
      try {
        await fetch('/api/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
          body: JSON.stringify(
            valid.map((s) => ({
              name: s.name.trim() || undefined,
              email: s.email.trim() || undefined,
              role: s.role,
            }))
          ),
        });
      } catch {
        hadError = true;
        toast.error('Some staff members could not be saved — you can add them later in the dashboard.');
      } finally { setLoading(false); }
      if (hadError) return;
    }
    next();
  }

  async function submitFaqs() {
    const valid = faqs.filter((f) => f.question.trim() && f.answer.trim());
    if (valid.length > 0 && tenantId) {
      setLoading(true);
      let hadError = false;
      try {
        await Promise.all(
          valid.map((f) =>
            fetch('/api/faqs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
              body: JSON.stringify({
                question: f.question.trim(),
                answer: f.answer.trim(),
                category: f.category.trim() || undefined,
              }),
            })
          )
        );
      } catch {
        hadError = true;
        toast.error('Some FAQs could not be saved — you can add them later in the FAQ dashboard.');
      } finally { setLoading(false); }
      if (hadError) return;
    }
    next();
  }

  function updateService(i: number, k: keyof ServiceDraft, v: string) {
    setServices((p) => p.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)));
  }
  function updateStaff<K extends keyof StaffDraft>(i: number, k: K, v: StaffDraft[K]) {
    setStaffList((p) => p.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)));
  }
  function updateFaq(i: number, k: keyof FaqDraft, v: string) {
    setFaqs((p) => p.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)));
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border rounded-2xl p-8 shadow-sm">

        {step !== 'done' && <StepIndicator current={step} />}

        {step === 'basics' && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Welcome to Boka 👋</h1>
            <p className="text-sm text-gray-600">Tell us about your business to get started.</p>
            <div>
              <label className="block text-sm font-medium mb-1">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Glow Salon" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Business Type</label>
              <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select type…</option>
                <option value="salon">Salon / Beauty</option>
                <option value="clinic">Clinic / Health</option>
                <option value="fitness">Fitness / Wellness</option>
                <option value="consulting">Consulting</option>
                <option value="photography">Photography</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Short Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Shown on your public booking page" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Timezone</label>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Africa/Lagos" />
            </div>
            <button onClick={submitBasics} disabled={loading}
              className="w-full py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-60 font-medium">
              {loading ? 'Creating…' : 'Continue →'}
            </button>
          </div>
        )}

        {step === 'services' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">What services do you offer?</h2>
            <p className="text-sm text-gray-600">Add your services so clients can book them. You can add more later.</p>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {services.map((s, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">Service {i + 1}</span>
                    {services.length > 1 && (
                      <button onClick={() => setServices((p) => p.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    )}
                  </div>
                  <input value={s.name} onChange={(e) => updateService(i, 'name', e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm" placeholder="Service name (e.g. Haircut)" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={s.duration} onChange={(e) => updateService(i, 'duration', e.target.value)}
                      className="border rounded px-3 py-1.5 text-sm" placeholder="Duration (mins)" inputMode="numeric" />
                    <input value={s.price} onChange={(e) => updateService(i, 'price', e.target.value)}
                      className="border rounded px-3 py-1.5 text-sm" placeholder="Price" inputMode="decimal" />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setServices((p) => [...p, { name: '', duration: '', price: '' }])}
              className="text-sm text-indigo-600 hover:underline">+ Add another service</button>
            <div className="flex gap-3 pt-2">
              <button onClick={back} className="flex-1 py-2 border rounded-lg text-sm">← Back</button>
              <button onClick={submitServices} disabled={loading}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-60 font-medium text-sm">
                {loading ? 'Saving…' : 'Continue →'}
              </button>
            </div>
            <button onClick={next} className="w-full text-xs text-gray-400 hover:underline">Skip for now</button>
          </div>
        )}

        {step === 'staff' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Invite your team</h2>
            <p className="text-sm text-gray-600">Add staff members who will be providing services.</p>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {staffList.map((s, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">Staff {i + 1}</span>
                    {staffList.length > 1 && (
                      <button onClick={() => setStaffList((p) => p.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    )}
                  </div>
                  <input value={s.name} onChange={(e) => updateStaff(i, 'name', e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm" placeholder="Name" />
                  <input value={s.email} onChange={(e) => updateStaff(i, 'email', e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm" placeholder="Email" type="email" />
                  <select value={s.role} onChange={(e) => updateStaff(i, 'role', e.target.value as 'owner' | 'staff')}
                    className="w-full border rounded px-3 py-1.5 text-sm">
                    <option value="staff">Staff</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              ))}
            </div>
            <button onClick={() => setStaffList((p) => [...p, { name: '', email: '', role: 'staff' }])}
              className="text-sm text-indigo-600 hover:underline">+ Add another staff member</button>
            <div className="flex gap-3 pt-2">
              <button onClick={back} className="flex-1 py-2 border rounded-lg text-sm">← Back</button>
              <button onClick={submitStaff} disabled={loading}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-60 font-medium text-sm">
                {loading ? 'Saving…' : 'Continue →'}
              </button>
            </div>
            <button onClick={next} className="w-full text-xs text-gray-400 hover:underline">Skip for now</button>
          </div>
        )}

        {step === 'faqs' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Build your knowledge base</h2>
            <p className="text-sm text-gray-600">
              Add FAQs to help your AI agent answer customer questions automatically.
            </p>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {faqs.map((f, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">FAQ {i + 1}</span>
                    {faqs.length > 1 && (
                      <button onClick={() => setFaqs((p) => p.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    )}
                  </div>
                  <input value={f.question} onChange={(e) => updateFaq(i, 'question', e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    placeholder="e.g. What is your cancellation policy?" />
                  <textarea value={f.answer} onChange={(e) => updateFaq(i, 'answer', e.target.value)}
                    rows={2} className="w-full border rounded px-3 py-1.5 text-sm resize-none"
                    placeholder="Provide a clear answer…" />
                  <input value={f.category} onChange={(e) => updateFaq(i, 'category', e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm" placeholder="Category (optional)" />
                </div>
              ))}
            </div>
            <button onClick={() => setFaqs((p) => [...p, { question: '', answer: '', category: '' }])}
              className="text-sm text-indigo-600 hover:underline">+ Add another FAQ</button>
            <div className="flex gap-3 pt-2">
              <button onClick={back} className="flex-1 py-2 border rounded-lg text-sm">← Back</button>
              <button onClick={submitFaqs} disabled={loading}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-60 font-medium text-sm">
                {loading ? 'Saving…' : 'Finish Setup →'}
              </button>
            </div>
            <button onClick={next} className="w-full text-xs text-gray-400 hover:underline">Skip for now</button>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4 py-4">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-semibold">You&apos;re all set!</h2>
            <p className="text-sm text-gray-600">
              Your business is ready to accept bookings. Head to your dashboard to manage bookings,
              update settings, and more.
            </p>
            <div className="space-y-2 pt-2">
              <button onClick={() => router.replace('/dashboard')}
                className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium">
                Go to Dashboard
              </button>
              {tenantSlug && (
                <button
                  onClick={() => window.open(`/book/${tenantSlug}`, '_blank', 'noopener,noreferrer')}
                  className="w-full py-2 border rounded-lg text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  Preview your booking page ↗
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 pt-1">
              You can always update your business details from the dashboard settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
