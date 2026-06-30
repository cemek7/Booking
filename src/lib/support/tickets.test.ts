import { describe, expect, it } from '@jest/globals';
import {
  addMessage,
  assignTicket,
  createTicket,
  getTicketThread,
  listTickets,
  setTicketStatus,
} from '@/lib/support/tickets';

function makeAdmin(rows: Record<string, unknown[]> = {}) {
  const ops: Array<{ table: string; kind: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  const admin = {
    from(table: string) {
      const op = { table, kind: '', payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      ops.push(op);
      const b: Record<string, unknown> = {
        insert(p: unknown) { op.kind = 'insert'; op.payload = p; return b; },
        update(p: unknown) { op.kind = 'update'; op.payload = p; return b; },
        select() { op.kind ||= 'select'; return b; },
        eq(c: string, v: unknown) { op.filters.push([c, v]); return b; },
        order() { return b; },
        single() { return Promise.resolve({ data: (rows[table] ?? [])[0] ?? { id: 'tk1' }, error: null }); },
        maybeSingle() { return Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }); },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  return { admin: admin as never, ops };
}

describe('support/tickets', () => {
  it('createTicket inserts a ticket and first tenant message', async () => {
    const { admin, ops } = makeAdmin({ support_tickets: [{ id: 'tk1' }] });
    const id = await createTicket(admin, {
      tenantId: 't1',
      authorId: 'u1',
      subject: 'Need help',
      description: 'Booking issue',
      initialMessage: 'My booking is broken',
    });

    expect(id).toBe('tk1');
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'insert')?.payload).toMatchObject({
      tenant_id: 't1',
      subject: 'Need help',
      description: 'Booking issue',
      status: 'open',
    });
    expect(ops.find((o) => o.table === 'support_messages' && o.kind === 'insert')?.payload).toMatchObject({
      ticket_id: 'tk1',
      author_id: 'u1',
      author_role: 'tenant',
      body: 'My booking is broken',
    });
  });

  it('addMessage inserts a row and bumps ticket updated_at', async () => {
    const { admin, ops } = makeAdmin();
    await addMessage(admin, {
      ticketId: 'tk1',
      authorId: 'u2',
      authorRole: 'support',
      body: 'We are looking into it',
    });

    expect(ops.find((o) => o.table === 'support_messages' && o.kind === 'insert')?.payload).toMatchObject({
      ticket_id: 'tk1',
      author_id: 'u2',
      author_role: 'support',
      body: 'We are looking into it',
    });
    expect(ops.some((o) => o.table === 'support_tickets' && o.kind === 'update')).toBe(true);
  });

  it('getTicketThread is tenant scoped', async () => {
    const { admin, ops } = makeAdmin({
      support_tickets: [{ id: 'tk1', tenant_id: 't1' }],
      support_messages: [{ id: 'm1' }],
      support_assignments: [{ id: 'a1' }],
    });

    const thread = await getTicketThread(admin, { ticketId: 'tk1', tenantId: 't1' });

    expect(thread?.ticket).toMatchObject({ id: 'tk1' });
    expect(thread?.messages).toEqual([{ id: 'm1' }]);
    expect(thread?.assignments).toEqual([{ id: 'a1' }]);
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'select')?.filters).toEqual(
      expect.arrayContaining([['id', 'tk1'], ['tenant_id', 't1']])
    );
  });

  it('setTicketStatus updates the ticket row', async () => {
    const { admin, ops } = makeAdmin();
    await setTicketStatus(admin, { ticketId: 'tk1', status: 'resolved' });
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'update')?.payload).toMatchObject({
      status: 'resolved',
    });
  });

  it('assignTicket inserts assignment history and updates current assignee', async () => {
    const { admin, ops } = makeAdmin();
    await assignTicket(admin, { ticketId: 'tk1', assignedTo: 'support-1', assignedBy: 'support-2' });

    expect(ops.find((o) => o.table === 'support_assignments' && o.kind === 'insert')?.payload).toMatchObject({
      ticket_id: 'tk1',
      assigned_to: 'support-1',
      assigned_by: 'support-2',
    });
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'update')?.payload).toMatchObject({
      assignee_id: 'support-1',
    });
  });

  it('listTickets scopes to tenant when provided', async () => {
    const { admin, ops } = makeAdmin({ support_tickets: [{ id: 'tk1' }] });
    await listTickets(admin, { tenantId: 'tenant-1', status: 'open' });
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'select')?.filters).toEqual(
      expect.arrayContaining([['tenant_id', 'tenant-1'], ['status', 'open']])
    );
  });
});
