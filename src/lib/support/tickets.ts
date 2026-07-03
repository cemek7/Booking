import type { SupabaseClient } from '@supabase/supabase-js';

export type SupportTicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'normal' | 'high';
export type SupportAuthorRole = 'tenant' | 'support';

export interface SupportTicketRow {
  id: string;
  tenant_id: string | null;
  subject: string;
  description: string | null;
  status: SupportTicketStatus;
  priority: SupportTicketPriority | null;
  escalated: boolean;
  escalated_at: string | null;
  escalated_by: string | null;
  assignee_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string;
}

export interface SupportMessageRow {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_role: SupportAuthorRole | string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface SupportAssignmentRow {
  id: string;
  ticket_id: string;
  assigned_to: string;
  assigned_by: string | null;
  created_at: string;
}

export interface SupportTicketThread {
  ticket: SupportTicketRow;
  messages: SupportMessageRow[];
  assignments: SupportAssignmentRow[];
}

export interface CreateSupportTicketInput {
  tenantId: string;
  subject: string;
  description?: string | null;
  priority?: SupportTicketPriority;
  authorId?: string | null;
  initialMessage: string;
  metadata?: Record<string, unknown> | null;
}

export interface AddSupportMessageInput {
  ticketId: string;
  authorId?: string | null;
  authorRole: SupportAuthorRole;
  body: string;
  isInternal?: boolean;
}

export interface AssignSupportTicketInput {
  ticketId: string;
  assignedTo: string;
  assignedBy?: string | null;
}

export async function createTicket(
  admin: SupabaseClient,
  input: CreateSupportTicketInput
): Promise<string> {
  const { data, error } = await admin
    .from('support_tickets')
    .insert({
      tenant_id: input.tenantId,
      subject: input.subject,
      description: input.description ?? null,
      status: 'open',
      priority: input.priority ?? 'normal',
      metadata: input.metadata ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw error ?? new Error('Failed to create support ticket');
  }

  await addMessage(admin, {
    ticketId: data.id,
    authorId: input.authorId ?? null,
    authorRole: 'tenant',
    body: input.initialMessage,
  });

  return data.id;
}

export async function addMessage(
  admin: SupabaseClient,
  input: AddSupportMessageInput
): Promise<void> {
  const { error } = await admin
    .from('support_messages')
    .insert({
      ticket_id: input.ticketId,
      author_id: input.authorId ?? null,
      author_role: input.authorRole,
      body: input.body,
      is_internal: input.isInternal ?? false,
    });

  if (error) {
    throw error;
  }

  const { error: updateError } = await admin
    .from('support_tickets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.ticketId);

  if (updateError) {
    throw updateError;
  }
}

export async function listTickets(
  admin: SupabaseClient,
  input: { tenantId?: string; status?: SupportTicketStatus; assigneeId?: string }
): Promise<SupportTicketRow[]> {
  let query = admin
    .from('support_tickets')
    .select('*')
    .order('updated_at', { ascending: false });

  if (input.tenantId) {
    query = query.eq('tenant_id', input.tenantId);
  }

  if (input.status) {
    query = query.eq('status', input.status);
  }

  if (input.assigneeId) {
    query = query.eq('assignee_id', input.assigneeId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data as SupportTicketRow[]) ?? [];
}

export async function getTicketThread(
  admin: SupabaseClient,
  input: { ticketId: string; tenantId?: string; includeInternal?: boolean }
): Promise<SupportTicketThread | null> {
  let ticketQuery = admin.from('support_tickets').select('*').eq('id', input.ticketId);
  if (input.tenantId) {
    ticketQuery = ticketQuery.eq('tenant_id', input.tenantId);
  }

  const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();
  if (ticketError) {
    throw ticketError;
  }
  if (!ticket) {
    return null;
  }

  let messagesQuery = admin
    .from('support_messages')
    .select('*')
    .eq('ticket_id', input.ticketId);

  if (input.includeInternal === false) {
    messagesQuery = messagesQuery.eq('is_internal', false);
  }

  const [{ data: messages, error: messagesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    messagesQuery.order('created_at', { ascending: true }),
    admin.from('support_assignments').select('*').eq('ticket_id', input.ticketId).order('created_at', { ascending: false }),
  ]);

  if (messagesError) {
    throw messagesError;
  }
  if (assignmentsError) {
    throw assignmentsError;
  }

  return {
    ticket: ticket as SupportTicketRow,
    messages: (messages as SupportMessageRow[]) ?? [],
    assignments: (assignments as SupportAssignmentRow[]) ?? [],
  };
}

export async function setTicketStatus(
  admin: SupabaseClient,
  input: { ticketId: string; status: SupportTicketStatus }
): Promise<void> {
  const { error } = await admin
    .from('support_tickets')
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('id', input.ticketId);

  if (error) {
    throw error;
  }
}

export async function assignTicket(
  admin: SupabaseClient,
  input: AssignSupportTicketInput
): Promise<void> {
  const assignedAt = new Date().toISOString();

  const { error: assignmentError } = await admin
    .from('support_assignments')
    .insert({
      ticket_id: input.ticketId,
      assigned_to: input.assignedTo,
      assigned_by: input.assignedBy ?? null,
      created_at: assignedAt,
    });

  if (assignmentError) {
    throw assignmentError;
  }

  const { error: ticketError } = await admin
    .from('support_tickets')
    .update({
      assignee_id: input.assignedTo,
      updated_at: assignedAt,
    })
    .eq('id', input.ticketId);

  if (ticketError) {
    throw ticketError;
  }
}
