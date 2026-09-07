export const dynamic = 'force-dynamic';

import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { defaultLogger } from '@/lib/logger';
import { BookaRevenueRequestSchema } from '@/lib/booka/revenue-intake';
import { cacheGet, cacheSet, isRedisConfigured } from '@/lib/redis';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60 * 60;

function validationDetails(issues: { path: PropertyKey[]; message: string }[]) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
  );
}

export const POST = createHttpHandler(
  async (ctx) => {
    const raw = await parseJsonBody<unknown>(ctx.request);

    if (
      raw &&
      typeof raw === 'object' &&
      'company_website' in raw &&
      typeof raw.company_website === 'string' &&
      raw.company_website.trim().length > 0
    ) {
      return { id: null, request_type: null, status: 'accepted' };
    }

    const parsed = BookaRevenueRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(validationDetails(parsed.error.issues));
    }

    if (isRedisConfigured()) {
      try {
        const ip =
          ctx.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          ctx.request.headers.get('x-real-ip')?.trim() ||
          'unknown';
        const key = `rate:booka-revenue-request:${ip}`;
        const current = ((await cacheGet(key)) as number | null) ?? 0;

        if (current >= RATE_LIMIT) {
          throw ApiErrorFactory.tooManyRequests();
        }

        await cacheSet(key, current + 1, RATE_WINDOW_SECONDS);
      } catch (error) {
        if (error instanceof Error && 'statusCode' in error && error.statusCode === 429) {
          throw error;
        }
        defaultLogger.warn('Booka revenue request rate-limit check failed; allowing request', {
          error: String(error),
        });
      }
    }

    const input = parsed.data;
    const payload = {
      request_type: input.request_type,
      business_name: input.business_name,
      contact_name: input.contact_name,
      email: input.email,
      phone: input.phone,
      vertical: input.vertical,
      other_vertical: input.other_vertical ?? null,
      weekly_enquiry_band: input.weekly_enquiry_band,
      channels: input.channels,
      average_transaction_value_ngn: input.average_transaction_value_ngn ?? null,
      current_conversion_band: input.current_conversion_band ?? null,
      instagram_handle: input.instagram_handle ?? null,
      website_url: input.website_url ?? null,
      consent_to_contact: input.consent_to_contact,
      sample_review_consent: input.sample_review_consent,
    };

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('booka_revenue_requests')
      .insert(payload)
      .select('id, request_type, status')
      .single();

    if (error?.code === '23505') {
      const { data: existing, error: existingError } = await admin
        .from('booka_revenue_requests')
        .select('id, request_type, status')
        .eq('request_type', input.request_type)
        .eq('email', input.email)
        .not('status', 'in', '(converted,closed)')
        .maybeSingle();

      if (existingError || !existing) {
        throw ApiErrorFactory.databaseError(
          new Error(existingError?.message || 'Existing revenue request could not be loaded'),
        );
      }

      return existing;
    }

    if (error || !data) {
      throw ApiErrorFactory.databaseError(
        new Error(error?.message || 'Revenue request could not be created'),
      );
    }

    return data;
  },
  'POST',
  { auth: false },
);
