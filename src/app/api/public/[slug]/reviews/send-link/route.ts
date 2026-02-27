/**
 * POST /api/public/[slug]/reviews/send-link
 *
 * Sends a personalised review link to a customer via WhatsApp.
 * The link points to /reviews/[slug]?reservationId=<id>
 *
 * Auth: requires owner/manager (this is an internal action, not public).
 */

import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import publicBookingService from '@/lib/publicBookingService';
import { z } from 'zod';

const SendLinkSchema = z.object({
  phone: z.string().min(7, 'Phone number is required'),
  customer_name: z.string().optional(),
  reservation_id: z.string().uuid().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    if (!['owner', 'manager'].includes(ctx.user!.role)) {
      throw ApiErrorFactory.insufficientPermissions(['owner', 'manager']);
    }

    const slug = ctx.params?.slug;
    if (!slug) throw ApiErrorFactory.badRequest('Slug required');

    const tenant = await publicBookingService.getTenantPublicInfo(slug);

    const raw = await parseJsonBody(ctx.request);
    const body = SendLinkSchema.parse(raw);

    // Build the public review URL — use server-side APP_URL, fall back to request origin
    let appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL;
    if (!appUrl) {
      const reqUrl = new URL(ctx.request.url);
      appUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    }
    const reviewUrl = body.reservation_id
      ? `${appUrl}/reviews/${slug}?reservationId=${body.reservation_id}`
      : `${appUrl}/reviews/${slug}`;

    const greeting = body.customer_name ? `Hi ${body.customer_name}! ` : 'Hi! ';
    const message =
      `${greeting}Thank you for your visit to *${tenant.name}*. 🙏\n\n` +
      `We'd love to hear about your experience. Please take a moment to leave us a review:\n\n` +
      `${reviewUrl}`;

    // Try to send via WhatsApp (Evolution API) — gracefully degrade if not configured
    let whatsappSent = false;
    try {
      const { sendWhatsAppMessage } = await import('@/lib/evolutionClient');
      const result = await sendWhatsAppMessage(tenant.id, body.phone, message);
      whatsappSent = result.success;
    } catch {
      // WhatsApp integration not configured — still return the link
    }

    return {
      success: true,
      whatsappSent,
      reviewUrl,
      message: whatsappSent
        ? 'Review link sent via WhatsApp'
        : 'Review link generated (WhatsApp not configured)',
    };
  },
  'POST',
  { auth: true }
);
