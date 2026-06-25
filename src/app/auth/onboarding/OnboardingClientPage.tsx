"use client";

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getVerticalPackage } from '@/lib/sias';
import { getStoredIsAdmin } from '@/lib/auth/token-storage';
import BrandMark from '@/components/brand/BrandMark';

interface ServiceDraft { name: string; duration: string; price: string }
interface StaffDraft { name: string; email: string; phone: string; role: 'owner' | 'staff' }
interface FaqDraft { question: string; answer: string; category: string }

const ONBOARDING_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ha', label: 'Hausa' },
  { code: 'ig', label: 'Igbo' },
  { code: 'sw', label: 'Swahili' },
];

const ONBOARDING_TONES = [
  'Friendly & casual',
  'Professional & formal',
  'Warm & supportive',
  'Concise & direct',
  'Playful & energetic',
];

const BOOKING_SOURCES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram DM' },
  { value: 'phone', label: 'Phone call' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'website', label: 'Website' },
];

type Step = 'basics' | 'services' | 'staff' | 'faqs' | 'agent' | 'whatsapp' | 'done';
const STEPS: Step[] = ['basics', 'services', 'staff', 'faqs', 'agent', 'whatsapp', 'done'];
const STEP_LABELS: Record<Step, string> = {
  basics: 'Business',
  services: 'Services',
  staff: 'Team',
  faqs: 'FAQs',
  agent: 'Agent',
  whatsapp: 'Channels',
  done: 'Done',
};
const BUSINESS_VERTICALS: Record<string, 'beauty' | 'hospitality' | 'medicine'> = {
  salon: 'beauty',
  beauty: 'beauty',
  spa: 'beauty',
  medspa: 'beauty',
  aesthetics: 'beauty',
  clinic: 'medicine',
  hospital: 'medicine',
  lab: 'medicine',
  restaurant: 'hospitality',
  hotel: 'hospitality',
  lounge: 'hospitality',
  event: 'hospitality',
};

function resolveVertical(businessType: string) {
  return BUSINESS_VERTICALS[businessType.trim().toLowerCase()] ?? 'beauty';
}

function StepIndicator({ current }: { current: Step }) {
  const visible = STEPS.filter((s) => s !== 'done');
  const currentIdx = STEPS.indexOf(current);
  return (
    <div className="mb-8 flex items-center justify-between">
      {visible.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200 ${
                  done
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                    : active
                    ? 'border-2 border-emerald-600 bg-white text-emerald-700 shadow-sm shadow-emerald-100'
                    : 'border-2 border-transparent bg-[#ebe7da] text-[#93a099]'
                }`}
              >
                {done ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`hidden text-[10px] font-medium sm:block ${active ? 'text-emerald-700' : done ? 'text-[#55685e]' : 'text-[#a5afa8]'}`}>
                {STEP_LABELS[step]}
              </span>
            </div>
            {i < visible.length - 1 && (
              <div className={`mx-1 mb-3 h-0.5 flex-1 transition-colors duration-300 sm:mb-4 ${i < currentIdx ? 'bg-emerald-600' : 'bg-[#e2ddcf]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const inputCls = "w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] placeholder:text-slate-400 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100";
const selectCls = "w-full appearance-none rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100";
const textareaCls = "w-full resize-none rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-[var(--brand-ink)] placeholder:text-slate-400 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100";
const primaryBtn = "w-full rounded-full bg-emerald-600 py-3 text-sm font-medium text-white shadow-[0_12px_24px_rgba(5,150,105,0.18)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn = "flex-1 rounded-full border border-[var(--brand-line)] bg-white py-3 text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:text-emerald-900";
const ghostBtn = "w-full py-1 text-xs text-slate-400 transition hover:text-slate-600";
const cardCls = "space-y-3 rounded-[1.6rem] border border-[var(--brand-line)] bg-[#fcfbf7] p-4";
const sectionTitleCls = "text-2xl font-semibold tracking-tight text-[var(--brand-ink)]";
const sectionCopyCls = "mt-1 text-sm leading-7 text-slate-600";
const labelCls = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.24em] text-[#597061]";

export default function OnboardingPage() {
  const router = useRouter();
  const tokenRef = useRef<string | null>(null);

  const [step, setStep] = useState<Step>('basics');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [description, setDescription] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [businessNickname, setBusinessNickname] = useState('');
  const [bookingSources, setBookingSources] = useState<string[]>(['whatsapp']);
  const [services, setServices] = useState<ServiceDraft[]>([{ name: '', duration: '', price: '' }]);
  const [staffList, setStaffList] = useState<StaffDraft[]>([{ name: '', email: '', phone: '', role: 'staff' }]);
  const [faqs, setFaqs] = useState<FaqDraft[]>([{ question: '', answer: '', category: '' }]);
  const [loading, setLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [agentTone, setAgentTone] = useState('');
  const [agentLanguage, setAgentLanguage] = useState('en');
  const [agentGreeting, setAgentGreeting] = useState('');
  const [agentBusinessHours, setAgentBusinessHours] = useState<Record<string, { open: string | null; close: string | null; closed: boolean }> | null>(null);
  const [agentWebsiteUrl, setAgentWebsiteUrl] = useState('');
  const [agentScraping, setAgentScraping] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState('');
  const [instagramProfileUrl, setInstagramProfileUrl] = useState('');
  const [instagramDmGoal, setInstagramDmGoal] = useState<'bookings' | 'lead_capture' | 'support'>('bookings');
  const [instagramUseDmReplies, setInstagramUseDmReplies] = useState(true);
  const [notifyNewBookings, setNotifyNewBookings] = useState(true);
  const [notifyCancellations, setNotifyCancellations] = useState(true);
  const [notifyDailySummary, setNotifyDailySummary] = useState(true);
  const [notifyWeeklySummary, setNotifyWeeklySummary] = useState(false);
  const selectedPackage = getVerticalPackage(resolveVertical(businessType || 'salon'));

  const baseHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return {
      ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
      ...extra,
    };
  }, []);

  const jsonHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return {
      'Content-Type': 'application/json',
      ...baseHeaders(extra),
    };
  }, [baseHeaders]);

  const tenantHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return tenantId ? baseHeaders({ 'X-Tenant-ID': tenantId, ...extra }) : baseHeaders(extra);
  }, [baseHeaders, tenantId]);

  // Get session token on mount; refresh if needed before API calls
  useEffect(() => {
    if (getStoredIsAdmin()) {
      router.replace('/dashboard/superadmin');
      return;
    }

    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then((result: { data: { session?: { access_token?: string | null } | null } }) => {
      const data = result.data as { session?: { access_token?: string | null } | null };
      if (data.session?.access_token) {
        tokenRef.current = data.session.access_token;
      }
    });
    // Keep token fresh via auth state changes (e.g. token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { access_token?: string | null } | null) => {
      if (session?.access_token) tokenRef.current = session.access_token;
    });
    return () => subscription.unsubscribe();
  }, [router]);

  function next() { setStep((s) => STEPS[Math.min(STEPS.indexOf(s) + 1, STEPS.length - 1)]); }
  function back() { setStep((s) => STEPS[Math.max(STEPS.indexOf(s) - 1, 0)]); }

  function toggleBookingSource(source: string) {
    setBookingSources((current) => {
      if (current.includes(source)) {
        return current.filter((entry) => entry !== source);
      }
      return [...current, source];
    });
  }

  function isValidIANATimezone(tz: string): boolean {
    try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
  }

  async function submitBasics() {
    if (!name.trim()) { toast.error('Business name is required'); return; }
    if (!ownerName.trim()) { toast.error('Owner name is required'); return; }
    if (!ownerPhone.trim()) { toast.error('Owner WhatsApp number is required'); return; }
    if (timezone.trim() && !isValidIANATimezone(timezone.trim())) {
      toast.error('Invalid timezone — use IANA format (e.g. Africa/Lagos, Europe/London)');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/onboarding/tenant', {
        method: 'POST',
        headers: jsonHeaders(),
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
        const vertical = resolveVertical(businessType || 'salon');
        const pkg = getVerticalPackage(vertical);
        await fetch(`/api/tenants/${json.tenantId}/settings`, {
          method: 'PATCH',
          headers: jsonHeaders(),
          body: JSON.stringify({
            managedOnboarding: true,
            verticalPackage: pkg.id,
            positioning: pkg.positioning,
            managedPromise: pkg.managedPromise,
            outcomeTargets: pkg.outcomes,
            escalationRules: pkg.escalationRules,
            billingModel: pkg.billingModel,
            operationalMemory: {
              mode: 'managed',
              memorySignals: pkg.memorySignals,
              outcomeAttribution: ['no_show_reduction', 'revenue_recovery', 'repeat_booking_lift', 'reactivation_lift'],
            },
            campaignDefaults: {
              reminders: ['24h', '2h'],
              reactivation: true,
              reviewRequests: true,
              escalation: 'human-first',
            },
            displayName: name.trim(),
            timezone: timezone.trim() || undefined,
            ownerName: ownerName.trim(),
            ownerPhone: ownerPhone.trim(),
            businessNickname: (businessNickname.trim() || name.trim()),
            bookingSources,
            tone: agentTone || undefined,
            preferred_language: agentLanguage || undefined,
            greeting: agentGreeting || undefined,
          }),
        });
      }
      next();
    } catch { toast.error('Network error'); }
    finally { setLoading(false); }
  }

  async function submitServices() {
    const valid = services.filter((s) => s.name.trim());
    if (valid.length > 0 && tenantId) {
      setLoading(true);
      try {
        await Promise.all(
          valid.map(async (s) => {
            const res = await fetch('/api/services', {
              method: 'POST',
              headers: jsonHeaders(tenantHeaders()),
              body: JSON.stringify({
                name: s.name.trim(),
                duration: s.duration ? Number(s.duration) : undefined,
                price: s.price ? Number(s.price) : undefined,
              }),
            });
            if (!res.ok) throw new Error(`service:${res.status}`);
          })
        );
      } catch {
        toast.error('Some services could not be saved — you can add them from the dashboard.');
      } finally { setLoading(false); }
    }
    next();
  }

  async function submitStaff() {
    const valid = staffList.filter((s) => s.name.trim() || s.email.trim());
    if (valid.length > 0 && tenantId) {
      setLoading(true);
      try {
        const res = await fetch('/api/staff', {
          method: 'POST',
          headers: jsonHeaders(tenantHeaders()),
          body: JSON.stringify(valid.map((s) => ({
            name: s.name.trim() || undefined,
            email: s.email.trim() || undefined,
            phone: s.phone.trim() || undefined,
            role: s.role,
          }))),
        });
        if (!res.ok) throw new Error(`staff:${res.status}`);
      } catch {
        toast.error('Some staff members could not be saved — you can add them later.');
      } finally { setLoading(false); }
    }
    next();
  }

  async function submitFaqs() {
    const valid = faqs.filter((f) => f.question.trim() && f.answer.trim());
    if (valid.length > 0 && tenantId) {
      setLoading(true);
      try {
        await Promise.all(
          valid.map(async (f) => {
            const res = await fetch('/api/faqs', {
              method: 'POST',
              headers: jsonHeaders(tenantHeaders()),
              body: JSON.stringify({
                question: f.question.trim(),
                answer: f.answer.trim(),
                category: f.category.trim() || undefined,
              }),
            });
            if (!res.ok) throw new Error(`faq:${res.status}`);
          })
        );
      } catch {
        toast.error('Some FAQs could not be saved — you can add them from the dashboard.');
      } finally { setLoading(false); }
    }
    next();
  }

  async function submitAgent() {
    if (!tenantId) { next(); return; }
    setLoading(true);
    try {
      const vertical = resolveVertical(businessType || 'salon');
      const pkg = getVerticalPackage(vertical);
      const agentMeta: Record<string, unknown> = {
        managedOnboarding: true,
        verticalPackage: pkg.id,
        positioning: pkg.positioning,
        managedPromise: pkg.managedPromise,
        outcomeTargets: pkg.outcomes,
        escalationRules: pkg.escalationRules,
        billingModel: pkg.billingModel,
        operationalMemory: {
          mode: 'managed',
          memorySignals: pkg.memorySignals,
          operationalNotes: agentWebsiteUrl.trim() ? ['website_scraped_faqs'] : ['manual_setup'],
        },
        campaignDefaults: {
          reminders: ['24h', '2h'],
          reactivation: true,
          reviewRequests: true,
          retryPolicy: 'three_attempts',
        },
      };
      if (agentTone) agentMeta.tone_config = { tone: agentTone, greeting: agentGreeting };
      if (agentLanguage && agentLanguage !== 'en') agentMeta.preferred_language = agentLanguage;
      if (agentBusinessHours) agentMeta.business_hours = agentBusinessHours;

      if (Object.keys(agentMeta).length > 0) {
        await fetch(`/api/tenants/${tenantId}/settings`, {
          method: 'PATCH',
          headers: jsonHeaders(tenantHeaders()),
          body: JSON.stringify(agentMeta),
        });
      }

      if (agentWebsiteUrl.trim()) {
        setAgentScraping(true);
        try {
          await fetch('/api/agent/scrape-faqs', {
            method: 'POST',
            headers: jsonHeaders(tenantHeaders()),
            body: JSON.stringify({ url: agentWebsiteUrl.trim(), save: true }),
          });
        } catch { /* non-fatal */ }
        setAgentScraping(false);
      }
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
    next();
  }

  async function finalizeChannels() {
    if (tenantId) {
      setLoading(true);
      try {
        await fetch(`/api/tenants/${tenantId}/settings`, {
          method: 'PATCH',
          headers: jsonHeaders(tenantHeaders()),
          body: JSON.stringify({
            ownerPhone: ownerPhone.trim() || undefined,
            notificationPreferences: {
              newBookings: notifyNewBookings,
              cancellations: notifyCancellations,
              dailySummary: notifyDailySummary,
              weeklySummary: notifyWeeklySummary,
            },
            channelConfig: {
              whatsapp: {
                mode: 'shared_booka_number',
                ownerCommandPhone: ownerPhone.trim() || undefined,
                sendBookingAlerts: notifyNewBookings,
                sendDailySummary: notifyDailySummary,
                sendWeeklySummary: notifyWeeklySummary,
                sendCancellationAlerts: notifyCancellations,
              },
              instagram: {
                handle: instagramHandle.trim() || undefined,
                profileUrl: instagramProfileUrl.trim() || undefined,
                dmGoal: instagramDmGoal,
                useDmReplies: instagramUseDmReplies,
              },
            },
          }),
        });
      } catch {
        toast.error('Channel settings could not be saved. You can update them later from the dashboard.');
      } finally {
        setLoading(false);
      }
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(212,179,104,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(5,150,105,0.08),transparent_26%),linear-gradient(180deg,#f8f7f2_0%,#f3f0e6_100%)] p-4 sm:p-6">
      <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <aside className="rounded-[2rem] border border-[var(--brand-line)] bg-[#10211a] p-6 text-[#f5f2e8] shadow-[0_30px_80px_rgba(16,33,26,0.18)] lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandMark variant="booka" className="h-12 w-12 shadow-sm shadow-emerald-600/20" />
              <div>
                <p className="brand-kicker text-emerald-300/75">Booka</p>
                <p className="mt-1 text-sm text-[#d6ddd9]">by Techclave</p>
              </div>
            </div>
            <Link href="/booka" className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-xs text-[#f5f2e8] transition hover:bg-white/10">
              Product
            </Link>
          </div>

          <p className="mt-8 text-xs uppercase tracking-[0.34em] text-emerald-300/55">Managed onboarding</p>
          <h1 className="techclave-display mt-4 text-5xl text-[#f5f2e8] sm:text-6xl">
            Set up Booka once. Run the front desk with less manual work.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-[#d6ddd9]">
            This setup configures your booking workflows, AI tone, service structure, and channel preferences for
            WhatsApp and Instagram in one branded path.
          </p>

          <div className="mt-8 grid gap-3">
            {[
              'Booking intake and reminders',
              'WhatsApp operations and Instagram lead capture',
              'Vertical-aware setup for beauty, clinics, and hospitality',
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-white/8 bg-white/6 px-4 py-3 text-sm text-[#f5f2e8]">
                {item}
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[1.5rem] border border-emerald-300/20 bg-emerald-400/8 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300/70">Flow</div>
            <p className="mt-3 text-sm leading-7 text-[#d6ddd9]">
              Business setup, services, team, FAQ knowledge, agent behaviour, then channel setup.
            </p>
          </div>
        </aside>

        <div className="rounded-[2rem] border border-[var(--brand-line)] bg-white/92 p-6 shadow-[0_24px_80px_rgba(16,33,26,0.08)] sm:p-8">
          {step !== 'done' && <StepIndicator current={step} />}

          {/* ── Basics ── */}
          {step === 'basics' && (
            <div className="space-y-5">
              <div>
                <h1 className={sectionTitleCls}>Welcome to Booka</h1>
                <p className={sectionCopyCls}>Let&apos;s set up your business in a few quick steps.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>
                    Business Name <span className="text-red-400">*</span>
                  </label>
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    className={inputCls} placeholder="e.g. Glow Salon" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>
                      Owner name <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className={inputCls}
                      placeholder="e.g. Ada Obi"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Owner WhatsApp <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                      className={inputCls}
                      placeholder="+2348012345678"
                      type="tel"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Business Type</label>
                  <div className="relative">
                    <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className={selectCls}>
                      <option value="">Select type…</option>
                      <option value="salon">Salon / Beauty</option>
                      <option value="medspa">Medspa / Aesthetics</option>
                      <option value="spa">Spa / Wellness</option>
                      <option value="clinic">Clinic / Health</option>
                      <option value="lab">Lab / Diagnostics</option>
                      <option value="hotel">Hotel / Hospitality</option>
                      <option value="restaurant">Restaurant / Dining</option>
                      <option value="fitness">Fitness / Wellness</option>
                      <option value="consulting">Consulting</option>
                      <option value="photography">Photography</option>
                      <option value="other">Other</option>
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Business nickname</label>
                  <input
                    value={businessNickname}
                    onChange={(e) => setBusinessNickname(e.target.value)}
                    className={inputCls}
                    placeholder="What customers should call you in chats"
                  />
                </div>
                <div>
                  <label className={labelCls}>Short Description</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                    rows={2} className={textareaCls} placeholder="What do you do? Shown on your booking page." />
                </div>
                <div>
                  <label className={labelCls}>Timezone</label>
                  <input value={timezone} onChange={(e) => setTimezone(e.target.value)}
                    className={inputCls} placeholder="e.g. Africa/Lagos" />
                </div>
                <div>
                  <label className={labelCls}>Where do most customers currently book?</label>
                  <div className="flex flex-wrap gap-2">
                    {BOOKING_SOURCES.map((source) => {
                      const active = bookingSources.includes(source.value);
                      return (
                        <button
                          key={source.value}
                          type="button"
                          onClick={() => toggleBookingSource(source.value)}
                          className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                            active
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-[var(--brand-line)] bg-white text-slate-600 hover:border-emerald-200'
                          }`}
                        >
                          {source.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-700">Managed package</div>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--brand-ink)]">{selectedPackage.name}</div>
                      <p className="mt-1 text-sm text-slate-600">{selectedPackage.managedPromise}</p>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-emerald-700 shadow-sm">
                      {selectedPackage.starterPlan.price}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedPackage.outcomes.slice(0, 3).map((outcome) => (
                      <span key={outcome} className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-700">
                        {outcome}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button onClick={submitBasics} disabled={loading} className={primaryBtn}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                    Creating…
                  </span>
                ) : 'Continue →'}
              </button>
            </div>
          )}

          {/* ── Services ── */}
          {step === 'services' && (
            <div className="space-y-5">
              <div>
                <h2 className={sectionTitleCls}>Your services</h2>
                <p className={sectionCopyCls}>Add the services clients can book. You can always add more later.</p>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-0.5">
                {services.map((s, i) => (
                  <div key={i} className={cardCls}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Service {i + 1}</span>
                      {services.length > 1 && (
                        <button onClick={() => setServices((p) => p.filter((_, idx) => idx !== i))}
                          className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors">Remove</button>
                      )}
                    </div>
                    <input value={s.name} onChange={(e) => updateService(i, 'name', e.target.value)}
                      className={inputCls} placeholder="Service name (e.g. Haircut)" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={s.duration} onChange={(e) => updateService(i, 'duration', e.target.value)}
                        className={inputCls} placeholder="Duration (mins)" inputMode="numeric" />
                      <input value={s.price} onChange={(e) => updateService(i, 'price', e.target.value)}
                        className={inputCls} placeholder="Price" inputMode="decimal" />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setServices((p) => [...p, { name: '', duration: '', price: '' }])}
                className="text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800">
                + Add another service
              </button>
              <div className="flex gap-3">
                <button onClick={back} className={secondaryBtn}>← Back</button>
                <button onClick={submitServices} disabled={loading} className={primaryBtn}>
                  {loading ? 'Saving…' : 'Continue →'}
                </button>
              </div>
              <button onClick={next} className={ghostBtn}>Skip for now</button>
            </div>
          )}

          {/* ── Staff ── */}
          {step === 'staff' && (
            <div className="space-y-5">
              <div>
                <h2 className={sectionTitleCls}>Invite your team</h2>
                <p className={sectionCopyCls}>Add staff who provide services. They&apos;ll get an invite email.</p>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-0.5">
                {staffList.map((s, i) => (
                  <div key={i} className={cardCls}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Staff {i + 1}</span>
                      {staffList.length > 1 && (
                        <button onClick={() => setStaffList((p) => p.filter((_, idx) => idx !== i))}
                          className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors">Remove</button>
                      )}
                    </div>
                    <input value={s.name} onChange={(e) => updateStaff(i, 'name', e.target.value)}
                      className={inputCls} placeholder="Full name" />
                    <input value={s.email} onChange={(e) => updateStaff(i, 'email', e.target.value)}
                      className={inputCls} placeholder="Email address" type="email" />
                    <input value={s.phone} onChange={(e) => updateStaff(i, 'phone', e.target.value)}
                      className={inputCls} placeholder="WhatsApp number (e.g. 2348012345678)" type="tel" />
                    <div className="relative">
                      <select value={s.role} onChange={(e) => updateStaff(i, 'role', e.target.value as 'owner' | 'staff')}
                        className={selectCls}>
                        <option value="staff">Staff</option>
                        <option value="owner">Owner</option>
                      </select>
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setStaffList((p) => [...p, { name: '', email: '', phone: '', role: 'staff' }])}
                className="text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800">
                + Add another staff member
              </button>
              <div className="flex gap-3">
                <button onClick={back} className={secondaryBtn}>← Back</button>
                <button onClick={submitStaff} disabled={loading} className={primaryBtn}>
                  {loading ? 'Saving…' : 'Continue →'}
                </button>
              </div>
              <button onClick={next} className={ghostBtn}>Skip for now</button>
            </div>
          )}

          {/* ── FAQs ── */}
          {step === 'faqs' && (
            <div className="space-y-5">
              <div>
                <h2 className={sectionTitleCls}>Knowledge base</h2>
                <p className={sectionCopyCls}>Add FAQs so your AI agent can answer customer questions automatically.</p>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-0.5">
                {faqs.map((f, i) => (
                  <div key={i} className={cardCls}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">FAQ {i + 1}</span>
                      {faqs.length > 1 && (
                        <button onClick={() => setFaqs((p) => p.filter((_, idx) => idx !== i))}
                          className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors">Remove</button>
                      )}
                    </div>
                    <input value={f.question} onChange={(e) => updateFaq(i, 'question', e.target.value)}
                      className={inputCls} placeholder="e.g. What is your cancellation policy?" />
                    <textarea value={f.answer} onChange={(e) => updateFaq(i, 'answer', e.target.value)}
                      rows={2} className={textareaCls} placeholder="Clear, helpful answer…" />
                    <input value={f.category} onChange={(e) => updateFaq(i, 'category', e.target.value)}
                      className={inputCls} placeholder="Category (optional, e.g. Pricing)" />
                  </div>
                ))}
              </div>
              <button onClick={() => setFaqs((p) => [...p, { question: '', answer: '', category: '' }])}
                className="text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800">
                + Add another FAQ
              </button>
              <div className="flex gap-3">
                <button onClick={back} className={secondaryBtn}>← Back</button>
                <button onClick={submitFaqs} disabled={loading} className={primaryBtn}>
                  {loading ? 'Saving…' : 'Continue →'}
                </button>
              </div>
              <button onClick={next} className={ghostBtn}>Skip for now</button>
            </div>
          )}

          {/* ── Agent ── */}
          {step === 'agent' && (
            <div className="space-y-5">
              <div>
                <h2 className={sectionTitleCls}>AI agent setup</h2>
                <p className={sectionCopyCls}>Personalise how your agent talks to customers. All settings are editable later.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Agent tone</label>
                  <div className="relative">
                    <select value={agentTone} onChange={(e) => setAgentTone(e.target.value)} className={selectCls}>
                      <option value="">Select a tone…</option>
                      {ONBOARDING_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Greeting message</label>
                  <input value={agentGreeting} onChange={(e) => setAgentGreeting(e.target.value)}
                    className={inputCls} placeholder="e.g. Hey! Welcome to {business name} 😊" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Preferred language</label>
                  <div className="relative">
                    <select value={agentLanguage} onChange={(e) => setAgentLanguage(e.target.value)} className={selectCls}>
                      {ONBOARDING_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Working days</label>
                  <div className="flex flex-wrap gap-2">
                    {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => {
                      const active = !(agentBusinessHours?.[day]?.closed ?? true);
                      return (
                        <button key={day} type="button"
                          onClick={() => {
                            const base = agentBusinessHours ?? {};
                            setAgentBusinessHours({ ...base, [day]: { open: !active ? '09:00' : null, close: !active ? '17:00' : null, closed: active } });
                          }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-[var(--brand-line)] bg-white text-slate-500 hover:border-emerald-200'}`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Website (optional — for FAQ extraction)</label>
                  <input value={agentWebsiteUrl} onChange={(e) => setAgentWebsiteUrl(e.target.value)}
                    className={inputCls} placeholder="https://yourbusiness.com" type="url" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={back} className={secondaryBtn}>← Back</button>
                <button onClick={submitAgent} disabled={loading || agentScraping} className={primaryBtn}>
                  {loading || agentScraping ? 'Saving…' : 'Continue →'}
                </button>
              </div>
              <button onClick={next} className={ghostBtn}>Skip for now</button>
            </div>
          )}

          {/* ── Channels ── */}
          {step === 'whatsapp' && (
            <div className="space-y-5">
              <div>
                <h2 className={sectionTitleCls}>Set up your channels</h2>
                <p className={sectionCopyCls}>Booka uses the shared Booka number for customer conversations. Here you register the owner command channel and optional Instagram DM setup.</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="rounded-[1.6rem] border border-[var(--brand-line)] bg-[#fcfbf7] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#597061]">Owner command channel</div>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className={labelCls}>Owner WhatsApp number</label>
                      <input
                        value={ownerPhone}
                        onChange={(e) => setOwnerPhone(e.target.value)}
                        className={inputCls}
                        placeholder="+2348012345678"
                        type="tel"
                      />
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 text-sm leading-6 text-slate-600">
                      This does not connect the tenant&apos;s WhatsApp account. Booka uses its shared number for customer chat and sends owner alerts, summaries, and escalation messages to this number.
                    </div>
                    <div className="grid gap-2">
                      <label className="flex items-center gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-slate-700">
                        <input type="checkbox" checked={notifyNewBookings} onChange={(e) => setNotifyNewBookings(e.target.checked)} />
                        <span>New bookings</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-slate-700">
                        <input type="checkbox" checked={notifyCancellations} onChange={(e) => setNotifyCancellations(e.target.checked)} />
                        <span>Cancellations</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-slate-700">
                        <input type="checkbox" checked={notifyDailySummary} onChange={(e) => setNotifyDailySummary(e.target.checked)} />
                        <span>Daily summary</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-slate-700">
                        <input type="checkbox" checked={notifyWeeklySummary} onChange={(e) => setNotifyWeeklySummary(e.target.checked)} />
                        <span>Weekly summary</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.6rem] border border-emerald-100 bg-emerald-50/60 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/70">Instagram setup</div>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className={labelCls}>Instagram handle</label>
                      <input value={instagramHandle} onChange={(e) => setInstagramHandle(e.target.value)} className={inputCls} placeholder="@yourbusiness" />
                    </div>
                    <div>
                      <label className={labelCls}>Instagram profile URL</label>
                      <input value={instagramProfileUrl} onChange={(e) => setInstagramProfileUrl(e.target.value)} className={inputCls} placeholder="https://instagram.com/yourbusiness" type="url" />
                    </div>
                    <div>
                      <label className={labelCls}>Primary DM goal</label>
                      <div className="relative">
                        <select value={instagramDmGoal} onChange={(e) => setInstagramDmGoal(e.target.value as 'bookings' | 'lead_capture' | 'support')} className={selectCls}>
                          <option value="bookings">Drive bookings</option>
                          <option value="lead_capture">Capture leads</option>
                          <option value="support">Handle support questions</option>
                        </select>
                        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInstagramUseDmReplies((value) => !value)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${instagramUseDmReplies ? 'border-emerald-200 bg-white text-[var(--brand-ink)]' : 'border-[var(--brand-line)] bg-[#fcfbf7] text-slate-500'}`}
                    >
                      <div className="font-medium">Use Booka for Instagram DM replies</div>
                      <div className="mt-1 text-xs text-slate-500">Best for enquiry handling before routing into booking or handoff.</div>
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={back} className={secondaryBtn}>← Back</button>
                <button onClick={finalizeChannels} disabled={loading} className={primaryBtn}>Continue →</button>
              </div>
              <button onClick={finalizeChannels} className={ghostBtn}>Skip for now</button>
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <div className="text-center space-y-5 py-4">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-4xl">
                🎉
              </div>
              <div>
                <h2 className="text-2xl font-bold text-[var(--brand-ink)]">You&apos;re all set!</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  Your business is ready to accept bookings. Head to your dashboard to manage everything.
                </p>
              </div>
              <div className="space-y-2.5 pt-2">
                <button onClick={() => router.replace('/dashboard')} className={primaryBtn}>
                  Go to Dashboard →
                </button>
                {tenantSlug && (
                  <button
                    onClick={() => window.open(`/book/${tenantSlug}`, '_blank', 'noopener,noreferrer')}
                    className="w-full rounded-full border border-emerald-200 py-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                  >
                    Preview booking page ↗
                  </button>
                )}
              </div>
              <p className="pt-1 text-xs text-slate-300">
                All settings can be updated from your dashboard.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
