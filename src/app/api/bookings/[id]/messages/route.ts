export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

/**
 * GET  /api/bookings/[id]/messages  — message history for a booking
 * POST /api/bookings/[id]/messages  — record an outbound message
 *
 * "Booking id" here is a reservation id (the /api/bookings family is a facade
 * over the canonical `reservations` table). Messages live in `public.messages`
 * keyed by `reservation_id`. Responses are shaped for the ChatThread component
 * ({ id, chatId, author, role, content, createdAt }).
 */

type MessageRow = {
  id: string;
  chat_id: string | null;
  from_number: string | null;
  content: string | null;
  direction: string | null;
  created_at: string;
};

function toChatMessage(row: MessageRow) {
  const inbound = (row.direction ?? 'inbound') === 'inbound';
  return {
    id: row.id,
    chatId: row.chat_id ?? '',
    author: row.from_number ?? (inbound ? 'Customer' : 'You'),
    role: inbound ? 'user' : 'assistant',
    content: row.content ?? '',
    createdAt: row.created_at,
  };
}

export const GET = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params?.id;
    if (!reservationId) throw ApiErrorFactory.validationError({ id: 'Booking id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const { data, error } = await ctx.supabase
      .from('messages')
      .select('id, chat_id, from_number, content, direction, created_at')
      .eq('tenant_id', tenantId)
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { messages: (data ?? []).map((r) => toChatMessage(r as MessageRow)) };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

const SendSchema = z.object({
  channel: z.enum(['whatsapp', 'email', 'sms', 'app']).default('app'),
  text: z.string().min(1, 'Message required'),
  attachments: z.array(z.unknown()).optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const reservationId = ctx.params?.id;
    if (!reservationId) throw ApiErrorFactory.validationError({ id: 'Booking id is required' });
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const parsed = SendSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }

    // Record the outbound message. Delivery to an external channel (WhatsApp
    // etc.) is handled by the messaging pipeline; here we persist it so it
    // shows in the thread immediately.
    const { data, error } = await ctx.supabase
      .from('messages')
      .insert([{
        tenant_id: tenantId,
        reservation_id: reservationId,
        content: parsed.data.text,
        direction: 'outbound',
        message_type: 'text',
      }])
      .select('id, chat_id, from_number, content, direction, created_at')
      .maybeSingle();

    if (error) throw ApiErrorFactory.databaseError(error);

    return { message: data ? toChatMessage(data as MessageRow) : null, success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
