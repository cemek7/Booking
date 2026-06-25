export const dynamic = 'force-dynamic';
/**
 * POST /api/agent/scrape-faqs
 * Scrape FAQ content from a website URL and optionally upsert to the faqs table.
 * Owner-only. Synchronous — client waits for results then reviews before saving.
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

const ScrapeSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  save: z.boolean().optional().default(false),
});

interface FaqItem {
  question: string;
  answer: string;
  source: string;
}

export const POST = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });

    const body = await parseJsonBody(ctx.request);
    const { url, save } = ScrapeSchema.parse(body);

    const items = await scrapeFaqs(url);

    if (save && items.length > 0) {
      const rows = items.slice(0, 20).map((item) => ({
        tenant_id: tenantId,
        question: item.question,
        answer: item.answer,
        category: 'scraped',
        is_active: true,
      }));

      const { error } = await ctx.supabase.from('faqs').upsert(rows, {
        onConflict: 'tenant_id,question',
        ignoreDuplicates: true,
      });
      if (error) throw ApiErrorFactory.databaseError(error);
    }

    return { found: items.length, items: items.slice(0, 20) };
  },
  'POST',
  { auth: true }
);

async function scrapeFaqs(url: string): Promise<FaqItem[]> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Boka-FAQ-Scraper/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new Error(`Failed to fetch URL: ${(e as Error).message}`);
  }

  const items: FaqItem[] = [];

  // 1. JSON-LD FAQPage schema
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      const schemas = Array.isArray(parsed) ? parsed : [parsed];
      for (const schema of schemas) {
        if (schema['@type'] === 'FAQPage' && Array.isArray(schema.mainEntity)) {
          for (const entity of schema.mainEntity) {
            if (entity['@type'] === 'Question' && entity.name) {
              const answer = entity.acceptedAnswer?.text ?? '';
              if (answer) items.push({ question: entity.name, answer: stripTags(answer), source: 'json-ld' });
            }
          }
        }
      }
    } catch { /* skip malformed JSON-LD */ }
  }

  if (items.length >= 20) return items.slice(0, 20);

  // 2. <details>/<summary> accordion pattern
  const detailsMatches = html.matchAll(/<details[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi);
  for (const match of detailsMatches) {
    const question = stripTags(match[1]).trim();
    const answer = stripTags(match[2]).trim();
    if (question && answer) {
      items.push({ question, answer, source: 'details-summary' });
      if (items.length >= 20) return items.slice(0, 20);
    }
  }

  // 3. Heading + paragraph pattern (h2/h3 followed by <p>)
  const headingParaMatches = html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>\s*(?:<[^>]+>\s*)*<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const match of headingParaMatches) {
    const question = stripTags(match[1]).trim();
    const answer = stripTags(match[2]).trim();
    if (question && answer && question.length > 10 && answer.length > 20) {
      items.push({ question, answer, source: 'heading-para' });
      if (items.length >= 20) return items.slice(0, 20);
    }
  }

  return items.slice(0, 20);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
