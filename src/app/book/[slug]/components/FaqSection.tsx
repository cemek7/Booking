'use client';

import { useEffect, useState } from 'react';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category?: string;
}

export default function FaqSection({ slug }: { slug: string }) {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/${slug}/faqs`)
      .then((r) => r.json())
      .then((j) => setFaqs(j.data ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <p className="text-sm text-slate-500">Loading FAQs…</p>;
  if (error) return <p className="text-sm text-slate-500">Unable to load FAQs. Please try again later.</p>;
  if (faqs.length === 0) return null;

  // Group by category
  const categories = Array.from(new Set(faqs.map((f) => f.category ?? 'General')));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-slate-900">Frequently Asked Questions</h2>
      {categories.map((cat) => (
        <div key={cat} className="space-y-2">
          {categories.length > 1 && (
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{cat}</h3>
          )}
          {faqs
            .filter((f) => (f.category ?? 'General') === cat)
            .map((faq) => (
              <div key={faq.id} className="border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenId(openId === faq.id ? null : faq.id)}
                  className="w-full text-left px-4 py-3 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors"
                >
                  <span className="text-sm font-medium text-slate-900">{faq.question}</span>
                  <span className="text-slate-400 text-lg leading-none ml-2">
                    {openId === faq.id ? '−' : '+'}
                  </span>
                </button>
                {openId === faq.id && (
                  <div className="px-4 py-3 bg-slate-50 border-t">
                    <p className="text-sm text-slate-600 whitespace-pre-line">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
