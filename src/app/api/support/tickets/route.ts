export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createTicket, listTickets } from '@/lib/support/tickets';

const CreateTicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  initialMessage: z.string().trim().min(3).max(4000),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    }

    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status');
    const admin = createSupabaseAdminClient();
    const [tickets, allTickets] = await Promise.all([
      listTickets(admin, {
        tenantId,
        status: status === 'open' || status === 'pending' || status === 'resolved' || status === 'closed'
          ? status
          : undefined,
      }),
      listTickets(admin, { tenantId }),
    ]);

    const counts = {
      open: 0,
      pending: 0,
      resolved: 0,
      closed: 0,
    };

    for (const ticket of allTickets) {
      counts[ticket.status] += 1;
    }

    return { tickets, counts };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const authorId = ctx.user?.id ?? null;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
    }

    const body = await ctx.request.json();
    const parsed = CreateTicketSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const admin = createSupabaseAdminClient();
    const ticketId = await createTicket(admin, {
      tenantId,
      authorId,
      subject: parsed.data.subject,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      initialMessage: parsed.data.initialMessage,
      metadata: parsed.data.metadata ?? null,
    });

    const ticket = await admin
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (ticket.error || !ticket.data) {
      throw ticket.error ?? new Error('Failed to load created ticket');
    }

    return { ticket: ticket.data };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);
