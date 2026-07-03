export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  addMessage,
  assignTicket,
  getTicketThread,
  setTicketStatus,
} from '@/lib/support/tickets';

const AddMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().optional(),
});

const PatchTicketSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    status: z.enum(['open', 'pending', 'resolved', 'closed']),
  }),
  z.object({
    action: z.literal('claim'),
  }),
  z.object({
    action: z.literal('unassign'),
  }),
]);

export const GET = createHttpHandler(
  async (ctx) => {
    const ticketId = ctx.params?.id;
    if (!ticketId) {
      throw ApiErrorFactory.validationError({ id: 'Ticket ID required' });
    }

    const admin = createSupabaseAdminClient();
    const tenantId = ctx.user?.role === 'superadmin' ? undefined : ctx.user?.tenantId;
    const thread = await getTicketThread(admin, {
      ticketId,
      tenantId,
      includeInternal: ctx.user?.role === 'superadmin',
    });

    if (!thread) {
      throw ApiErrorFactory.notFound('Support ticket not found');
    }

    return thread;
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff', 'superadmin'], requireTenantMembership: false }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const ticketId = ctx.params?.id;
    if (!ticketId) {
      throw ApiErrorFactory.validationError({ id: 'Ticket ID required' });
    }

    const body = await ctx.request.json();
    const parsed = AddMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const admin = createSupabaseAdminClient();
    const tenantId = ctx.user?.role === 'superadmin' ? undefined : ctx.user?.tenantId;
    const existing = await getTicketThread(admin, {
      ticketId,
      tenantId,
      includeInternal: ctx.user?.role === 'superadmin',
    });
    if (!existing) {
      throw ApiErrorFactory.notFound('Support ticket not found');
    }

    await addMessage(admin, {
      ticketId,
      authorId: ctx.user?.id ?? null,
      authorRole: ctx.user?.role === 'superadmin' ? 'support' : 'tenant',
      body: parsed.data.body,
      isInternal: ctx.user?.role === 'superadmin' ? parsed.data.isInternal ?? false : false,
    });

    const thread = await getTicketThread(admin, {
      ticketId,
      tenantId,
      includeInternal: ctx.user?.role === 'superadmin',
    });
    if (!thread) {
      throw ApiErrorFactory.notFound('Support ticket not found');
    }

    return thread;
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff', 'superadmin'], requireTenantMembership: false }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const ticketId = ctx.params?.id;
    if (!ticketId) {
      throw ApiErrorFactory.validationError({ id: 'Ticket ID required' });
    }

    const body = await ctx.request.json();
    const parsed = PatchTicketSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const admin = createSupabaseAdminClient();
    const tenantId = ctx.user?.role === 'superadmin' ? undefined : ctx.user?.tenantId;
    const existing = await getTicketThread(admin, {
      ticketId,
      tenantId,
      includeInternal: ctx.user?.role === 'superadmin',
    });
    if (!existing) {
      throw ApiErrorFactory.notFound('Support ticket not found');
    }

    if (parsed.data.action === 'claim') {
      if (ctx.user?.role !== 'superadmin') {
        throw ApiErrorFactory.forbidden('Only superadmins can claim support tickets');
      }
      await assignTicket(admin, {
        ticketId,
        assignedTo: ctx.user.id,
        assignedBy: ctx.user.id,
      });
      await setTicketStatus(admin, { ticketId, status: 'pending' });
    } else if (parsed.data.action === 'unassign') {
      if (ctx.user?.role !== 'superadmin') {
        throw ApiErrorFactory.forbidden('Only superadmins can unassign support tickets');
      }
      const { error } = await admin
        .from('support_tickets')
        .update({
          assignee_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId);
      if (error) {
        throw error;
      }
    } else {
      await setTicketStatus(admin, {
        ticketId,
        status: parsed.data.status,
      });
    }

    const thread = await getTicketThread(admin, {
      ticketId,
      tenantId,
      includeInternal: ctx.user?.role === 'superadmin',
    });
    if (!thread) {
      throw ApiErrorFactory.notFound('Support ticket not found');
    }

    return thread;
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager', 'staff', 'superadmin'], requireTenantMembership: false }
);
