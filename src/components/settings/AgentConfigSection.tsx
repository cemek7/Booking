"use client";

import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { BusinessHoursSection, type BusinessHours } from './BusinessHoursSection';
import { FormSection } from './FormSection';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ha', label: 'Hausa' },
  { code: 'ig', label: 'Igbo' },
  { code: 'sw', label: 'Swahili' },
  { code: 'zu', label: 'Zulu' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'de', label: 'German' },
  { code: 'nl', label: 'Dutch' },
];

export interface AgentConfigValues {
  // Identity
  displayName?: string;
  greeting?: string;
  signature?: string;
  // Personality
  tone?: string;
  styleGuidelines?: string;
  voiceParameters?: Record<string, unknown>;
  samplePhrases?: string[];
  // Language
  preferred_language?: string;
  // Business hours
  business_hours?: BusinessHours | null;
  // Lead capture
  capture_leads?: boolean;
  follow_up_delay_hours?: number;
  follow_up_message_template?: string;
  // Voice (Pro)
  voice_notes_enabled?: boolean;
  voice_calls_enabled?: boolean;
  voice_stt_provider?: 'openai' | 'local';
  voice_tts_provider?: 'openai' | 'local';
  voice_character?: 'alloy' | 'nova' | 'echo' | 'shimmer' | 'onyx' | 'fable';
  reply_with_audio?: 'always' | 'when_user_uses_voice' | 'never';
  plan?: string;
}

interface Props {
  values: AgentConfigValues;
  onChange: (patch: Partial<AgentConfigValues>) => void;
  tenantId?: string;
}

interface ScrapedFaq {
  question: string;
  answer: string;
  source: string;
}

export function AgentConfigSection({ values, onChange, tenantId }: Props) {
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapedFaqs, setScrapedFaqs] = useState<ScrapedFaq[]>([]);
  const [selectedFaqs, setSelectedFaqs] = useState<Set<number>>(new Set());
  const [savingFaqs, setSavingFaqs] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');

  const isPro = ['pro', 'business'].includes(values.plan ?? '');

  async function handleScrape() {
    if (!scrapeUrl.trim()) return;
    setScraping(true);
    setScrapedFaqs([]);
    setSelectedFaqs(new Set());
    try {
      const res = await fetch('/api/agent/scrape-faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scrapeUrl.trim(), save: false }),
      });
      const data = await res.json() as { found: number; items: ScrapedFaq[] };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Scrape failed');
      setScrapedFaqs(data.items ?? []);
      if (data.found === 0) toast.info("We couldn't extract FAQs automatically. Add them manually.");
      else {
        setSelectedFaqs(new Set(data.items.map((_, i) => i)));
        toast.success(`Found ${data.found} FAQ${data.found !== 1 ? 's' : ''} — review and save below.`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScraping(false);
    }
  }

  async function handleSaveFaqs() {
    if (!tenantId || selectedFaqs.size === 0) return;
    setSavingFaqs(true);
    try {
      const toSave = scrapedFaqs.filter((_, i) => selectedFaqs.has(i));
      const res = await fetch('/api/agent/scrape-faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scrapeUrl.trim(), save: true }),
      });
      if (!res.ok) throw new Error('Failed to save FAQs');
      toast.success(`${toSave.length} FAQs saved to your knowledge base.`);
      setScrapedFaqs([]);
      setSelectedFaqs(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingFaqs(false);
    }
  }

  function addPhrase() {
    const t = phraseInput.trim();
    if (!t) return;
    const phrases = values.samplePhrases ?? [];
    if (!phrases.includes(t)) onChange({ samplePhrases: [...phrases, t] });
    setPhraseInput('');
  }

  function removePhrase(phrase: string) {
    onChange({ samplePhrases: (values.samplePhrases ?? []).filter((p) => p !== phrase) });
  }

  return (
    <div className="space-y-6">
      {/* Agent Identity */}
      <FormSection title="Agent Identity" description="How the agent introduces itself to customers.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Business Name</label>
            <input
              value={values.displayName ?? ''}
              onChange={(e) => onChange({ displayName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Glow Salon"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Greeting message</label>
            <input
              value={values.greeting ?? ''}
              onChange={(e) => onChange({ greeting: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Hey there! Welcome to Glow 😊"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Sign-off message</label>
            <input
              value={values.signature ?? ''}
              onChange={(e) => onChange({ signature: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Speak soon! — The Glow Team"
            />
          </div>
        </div>
      </FormSection>

      {/* Personality & Language */}
      <FormSection title="Personality & Language" description="Shape how the AI agent communicates.">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Tone adjectives</label>
              <input
                value={values.tone ?? ''}
                onChange={(e) => onChange({ tone: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. friendly, concise, professional"
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated adjectives</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Preferred language</label>
              <select
                value={values.preferred_language ?? 'en'}
                onChange={(e) => onChange({ preferred_language: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Style guidelines</label>
            <textarea
              value={values.styleGuidelines ?? ''}
              onChange={(e) => onChange({ styleGuidelines: e.target.value })}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="e.g. Keep responses under 3 sentences. Never use jargon."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Sample phrases</label>
            <div className="flex gap-2 mb-2">
              <input
                value={phraseInput}
                onChange={(e) => setPhraseInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhrase(); } }}
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="Type a phrase and press Enter"
              />
              <button type="button" onClick={addPhrase}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(values.samplePhrases ?? []).map((p) => (
                <span key={p} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full text-xs">
                  {p}
                  <button type="button" onClick={() => removePhrase(p)} className="hover:text-indigo-900">×</button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </FormSection>

      {/* Business Hours */}
      <FormSection title="Business Hours" description="The agent uses these to deliver warm out-of-hours messages.">
        <BusinessHoursSection
          value={values.business_hours}
          onChange={(h) => onChange({ business_hours: h })}
        />
      </FormSection>

      {/* Knowledge & FAQs */}
      <FormSection title="Knowledge & FAQs" description="Auto-extract FAQs from your website or add them manually.">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              placeholder="https://yourbusiness.com/faq"
              type="url"
            />
            <button
              type="button"
              onClick={handleScrape}
              disabled={scraping || !scrapeUrl.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-60 whitespace-nowrap"
            >
              {scraping ? 'Scanning…' : 'Scan for FAQs'}
            </button>
          </div>

          {scrapedFaqs.length > 0 && (
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-500 font-medium">
                Found {scrapedFaqs.length} FAQ{scrapedFaqs.length !== 1 ? 's' : ''} — uncheck any you don't want to save.
              </p>
              <div className="max-h-52 overflow-y-auto space-y-2">
                {scrapedFaqs.map((faq, i) => (
                  <label key={i} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedFaqs.has(i)}
                      onChange={(e) => {
                        const next = new Set(selectedFaqs);
                        e.target.checked ? next.add(i) : next.delete(i);
                        setSelectedFaqs(next);
                      }}
                      className="mt-1 rounded"
                    />
                    <div>
                      <p className="text-sm font-medium">{faq.question}</p>
                      <p className="text-xs text-gray-500 line-clamp-2">{faq.answer}</p>
                    </div>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={handleSaveFaqs}
                disabled={savingFaqs || selectedFaqs.size === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm disabled:opacity-60"
              >
                {savingFaqs ? 'Saving…' : `Save ${selectedFaqs.size} selected FAQ${selectedFaqs.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </div>
      </FormSection>

      {/* Lead Capture */}
      <FormSection title="Lead Capture & Follow-up" description="Automatically capture and follow up with customers who don't complete a booking.">
        <div className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={values.capture_leads ?? false}
              onChange={(e) => onChange({ capture_leads: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm">Capture leads from incomplete conversations</span>
          </label>

          {values.capture_leads && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Follow-up delay (hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={values.follow_up_delay_hours ?? 24}
                  onChange={(e) => onChange({ follow_up_delay_hours: Number(e.target.value) })}
                  className="w-28 border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Follow-up message template</label>
                <textarea
                  value={values.follow_up_message_template ?? ''}
                  onChange={(e) => onChange({ follow_up_message_template: e.target.value })}
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="Hi {name}, still thinking about booking? We'd love to help!"
                />
                <p className="text-xs text-gray-500 mt-1">Use {'{name}'} as a placeholder for the customer's name.</p>
              </div>
            </>
          )}
        </div>
      </FormSection>

      {/* Voice Support — Pro only */}
      <FormSection
        title="Voice Call Support"
        aside={
          !isPro ? (
            <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">PRO</span>
          ) : undefined
        }
        description="Enable WhatsApp voice notes and WebRTC call links for real-time AI conversations."
      >
        {!isPro ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-gray-600">Upgrade to Pro to enable inbound voice booking.</p>
            <a
              href="/dashboard/settings?tab=payments"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm"
            >
              Upgrade Plan
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={values.voice_notes_enabled ?? false}
                onChange={(e) => onChange({ voice_notes_enabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Voice notes (STT/TTS) — WhatsApp voice messages</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={values.voice_calls_enabled ?? false}
                onChange={(e) => onChange({ voice_calls_enabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">WebRTC call link — real-time browser voice call</span>
            </label>

            {(values.voice_notes_enabled || values.voice_calls_enabled) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                {/* Technical model/provider controls (STT/TTS provider, voice model)
                    intentionally removed — tenants don't need that plumbing. The
                    platform picks sensible defaults. */}
                <div>
                  <label className="block text-sm font-medium mb-1">Reply with audio</label>
                  <select
                    value={values.reply_with_audio ?? 'when_user_uses_voice'}
                    onChange={(e) => onChange({ reply_with_audio: e.target.value as AgentConfigValues['reply_with_audio'] })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="when_user_uses_voice">When user sends voice</option>
                    <option value="always">Always</option>
                    <option value="never">Never (text only)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
      </FormSection>
    </div>
  );
}
