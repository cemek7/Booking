import { z } from 'zod';

export const RequestTypeSchema = z.enum(['revenue_pilot', 'missed_revenue_report']);
export const VerticalSchema = z.enum(['beauty', 'hospitality', 'clinic', 'other']);
export const WeeklyEnquiryBandSchema = z.enum([
  'under_20',
  '20_49',
  '50_99',
  '100_249',
  '250_plus',
]);
export const RequestStatusSchema = z.enum([
  'new',
  'qualified',
  'contacted',
  'audit_in_progress',
  'audit_ready',
  'pilot_scheduled',
  'converted',
  'closed',
]);

export const AuditSummarySchema = z
  .object({
    enquiries_reviewed: z.number().int().nonnegative(),
    unanswered_or_delayed: z.number().int().nonnegative(),
    missing_next_step: z.number().int().nonnegative(),
    availability_dead_ends: z.number().int().nonnegative(),
    missing_follow_ups: z.number().int().nonnegative(),
    missed_recommendations: z.number().int().nonnegative(),
    opportunity_low_ngn: z.number().nonnegative(),
    opportunity_high_ngn: z.number().nonnegative(),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1),
  })
  .refine((value) => value.opportunity_high_ngn >= value.opportunity_low_ngn, {
    message: 'opportunity_high_ngn must be at least opportunity_low_ngn',
    path: ['opportunity_high_ngn'],
  });

const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().max(max).optional(),
  );

const optionalUrl = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.url().max(500).optional(),
);

export const BookaRevenueRequestSchema = z
  .object({
    request_type: RequestTypeSchema,
    business_name: z.string().trim().min(2).max(120),
    contact_name: z.string().trim().min(2).max(120),
    email: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.email().toLowerCase().max(254),
    ),
    phone: z.string().trim().min(7).max(30),
    vertical: VerticalSchema,
    other_vertical: optionalTrimmedString(120),
    weekly_enquiry_band: WeeklyEnquiryBandSchema,
    channels: z
      .array(z.enum(['whatsapp', 'instagram']))
      .min(1)
      .max(2)
      .refine((channels) => new Set(channels).size === channels.length, {
        message: 'Channels must be unique',
      }),
    average_transaction_value_ngn: z.number().positive().max(999_999_999_999.99).optional(),
    current_conversion_band: z
      .enum(['unknown', 'under_10', '10_24', '25_49', '50_plus'])
      .optional(),
    instagram_handle: optionalTrimmedString(120),
    website_url: optionalUrl,
    consent_to_contact: z.literal(true),
    sample_review_consent: z.boolean().optional().default(false),
    company_website: z.string().max(0).optional().default(''),
  })
  .refine(
    (value) => value.vertical !== 'other' || Boolean(value.other_vertical),
    {
      message: 'Please describe the business vertical',
      path: ['other_vertical'],
    },
  );

export type BookaRevenueRequestInput = z.infer<typeof BookaRevenueRequestSchema>;
export type AuditSummary = z.infer<typeof AuditSummarySchema>;
export type RequestStatus = z.infer<typeof RequestStatusSchema>;
