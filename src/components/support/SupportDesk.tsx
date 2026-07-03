'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, authGet, authPatch, authPost } from '@/lib/auth/auth-api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Input from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  SupportAssignmentRow,
  SupportMessageRow,
  SupportTicketPriority,
  SupportTicketRow,
  SupportTicketStatus,
} from '@/lib/support/tickets';

type Mode = 'tenant' | 'superadmin';

interface SupportDeskProps {
  mode: Mode;
  role: 'owner' | 'manager' | 'staff' | 'superadmin';
}

interface TicketSummary extends SupportTicketRow {
  tenants?: { name?: string | null } | null;
}

interface TicketThreadResponse {
  ticket: SupportTicketRow;
  messages: SupportMessageRow[];
  assignments: SupportAssignmentRow[];
}

const STATUS_OPTIONS: SupportTicketStatus[] = ['open', 'pending', 'resolved', 'closed'];

function statusTone(status: SupportTicketStatus) {
  switch (status) {
    case 'open':
      return 'destructive';
    case 'pending':
      return 'secondary';
    case 'resolved':
      return 'default';
    case 'closed':
      return 'outline';
  }
}

function prettyDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function SupportDesk({ mode, role }: SupportDeskProps) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [counts, setCounts] = useState<Record<SupportTicketStatus, number>>({
    open: 0,
    pending: 0,
    resolved: 0,
    closed: 0,
  });
  const [activeStatus, setActiveStatus] = useState<SupportTicketStatus | 'all'>('all');
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [thread, setThread] = useState<TicketThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [queueScope, setQueueScope] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [ticketForm, setTicketForm] = useState({
    subject: '',
    description: '',
    priority: 'normal' as SupportTicketPriority,
    initialMessage: '',
  });

  const activeTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === activeTicketId) ?? null,
    [tickets, activeTicketId]
  );
  const totalCount = counts.open + counts.pending + counts.resolved + counts.closed;

  const refreshTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        mode === 'superadmin'
          ? `/api/superadmin/support?${new URLSearchParams(
              Object.fromEntries(
                Object.entries({
                  ...(activeStatus === 'all' ? {} : { status: activeStatus }),
                  ...(queueScope === 'all' ? {} : { assignee: queueScope }),
                }).filter(([, value]) => value)
              )
            ).toString()}`
          : `/api/support/tickets${activeStatus === 'all' ? '' : `?status=${activeStatus}`}`;
      const response = await authGet<{ tickets: TicketSummary[]; counts?: Record<SupportTicketStatus, number> }>(endpoint);
      if (response.error) throw new Error(response.error.message);

      const data = response.data ?? { tickets: [] as TicketSummary[] };
      setTickets(data.tickets ?? []);

      if (mode === 'superadmin' && data.counts) {
        setCounts(data.counts);
      } else {
        const nextCounts = { open: 0, pending: 0, resolved: 0, closed: 0 };
        for (const ticket of data.tickets ?? []) {
          nextCounts[ticket.status] += 1;
        }
        setCounts(nextCounts);
      }

      setActiveTicketId((current) => {
        if (current && (data.tickets ?? []).some((ticket) => ticket.id === current)) return current;
        return data.tickets?.[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support tickets');
      setTickets([]);
      setCounts({ open: 0, pending: 0, resolved: 0, closed: 0 });
    } finally {
      setLoading(false);
    }
  }, [activeStatus, mode, queueScope]);

  const loadThread = useCallback(async (ticketId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await authFetch<TicketThreadResponse>(`/api/support/tickets/${ticketId}`, { method: 'GET' });
      if (response.error) throw new Error(response.error.message);
      setThread(response.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support thread');
      setThread(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTickets();
  }, [refreshTickets]);

  useEffect(() => {
    if (!activeTicketId) {
      setThread(null);
      return;
    }
    void loadThread(activeTicketId);
  }, [activeTicketId, loadThread]);

  const submitTicket = useCallback(async () => {
    if (!ticketForm.subject.trim() || !ticketForm.initialMessage.trim()) {
      setError('Subject and message are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await authPost<{ ticket: TicketSummary }>('/api/support/tickets', {
        subject: ticketForm.subject.trim(),
        description: ticketForm.description.trim() || undefined,
        priority: ticketForm.priority,
        initialMessage: ticketForm.initialMessage.trim(),
      });
      if (response.error) throw new Error(response.error.message);
      setTicketForm({ subject: '', description: '', priority: 'normal', initialMessage: '' });
      await refreshTickets();
      if (response.data?.ticket?.id) {
        setActiveTicketId(response.data.ticket.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create support ticket');
    } finally {
      setSaving(false);
    }
  }, [refreshTickets, ticketForm]);

  const sendMessage = useCallback(async () => {
    if (!activeTicketId || !message.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authPost<TicketThreadResponse>(`/api/support/tickets/${activeTicketId}`, {
        body: message.trim(),
        isInternal: mode === 'superadmin' ? internalNote : false,
      });
      if (response.error) throw new Error(response.error.message);
      setThread(response.data ?? null);
      setMessage('');
      setInternalNote(false);
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send support reply');
    } finally {
      setSaving(false);
    }
  }, [activeTicketId, message, refreshTickets]);

  const updateStatus = useCallback(async (status: SupportTicketStatus) => {
    if (!activeTicketId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authPatch<TicketThreadResponse>(`/api/support/tickets/${activeTicketId}`, {
        action: 'status',
        status,
      });
      if (response.error) throw new Error(response.error.message);
      setThread(response.data ?? null);
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update support ticket');
    } finally {
      setSaving(false);
    }
  }, [activeTicketId, refreshTickets]);

  const claimTicket = useCallback(async () => {
    if (!activeTicketId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authPatch<TicketThreadResponse>(`/api/support/tickets/${activeTicketId}`, {
        action: 'claim',
      });
      if (response.error) throw new Error(response.error.message);
      setThread(response.data ?? null);
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim support ticket');
    } finally {
      setSaving(false);
    }
  }, [activeTicketId, refreshTickets]);

  const unassignTicket = useCallback(async () => {
    if (!activeTicketId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authPatch<TicketThreadResponse>(`/api/support/tickets/${activeTicketId}`, {
        action: 'unassign',
      });
      if (response.error) throw new Error(response.error.message);
      setThread(response.data ?? null);
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign support ticket');
    } finally {
      setSaving(false);
    }
  }, [activeTicketId, refreshTickets]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-6 shadow-sm">
        <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600">
          {mode === 'superadmin' ? 'Booka Support Queue' : 'Support'}
        </Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          {mode === 'superadmin' ? 'Tenant Support Tickets' : 'Get Help From Booka'}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          {mode === 'superadmin'
            ? 'Handle platform support cases raised by tenants without mixing them into customer chat operations.'
            : 'Open platform support tickets for billing, configuration, and Booka product issues. Customer chat help stays in the inbox.'}
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><div className="text-xs text-slate-500">Open</div><div className="mt-2 text-2xl font-semibold">{counts.open}</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-xs text-slate-500">Pending</div><div className="mt-2 text-2xl font-semibold">{counts.pending}</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-xs text-slate-500">Resolved</div><div className="mt-2 text-2xl font-semibold">{counts.resolved}</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-xs text-slate-500">Closed</div><div className="mt-2 text-2xl font-semibold">{counts.closed}</div></CardContent></Card>
      </div>

      {mode === 'tenant' ? (
        <Card>
          <CardHeader>
            <CardTitle>New Support Ticket</CardTitle>
            <CardDescription>Use this for platform issues, billing questions, or help from the Booka team.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Subject"
              value={ticketForm.subject}
              onChange={(event) => setTicketForm((current) => ({ ...current, subject: event.target.value }))}
            />
            <Textarea
              placeholder="Description (optional)"
              value={ticketForm.description}
              onChange={(event) => setTicketForm((current) => ({ ...current, description: event.target.value }))}
            />
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <select
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                value={ticketForm.priority}
                onChange={(event) => setTicketForm((current) => ({ ...current, priority: event.target.value as SupportTicketPriority }))}
              >
                <option value="low">Low priority</option>
                <option value="normal">Normal priority</option>
                <option value="high">High priority</option>
              </select>
              <Textarea
                placeholder="Initial message"
                value={ticketForm.initialMessage}
                onChange={(event) => setTicketForm((current) => ({ ...current, initialMessage: event.target.value }))}
              />
            </div>
            <Button onClick={submitTicket} disabled={saving}>
              {saving ? 'Creating…' : 'Create Ticket'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <Button variant={activeStatus === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveStatus('all')}>
          All ({totalCount})
        </Button>
        {STATUS_OPTIONS.map((status) => (
          <Button
            key={status}
            variant={activeStatus === status ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveStatus(status)}
          >
            {status}
          </Button>
        ))}
      </div>
      {mode === 'superadmin' ? (
        <div className="flex gap-2 flex-wrap">
          <Button variant={queueScope === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setQueueScope('all')}>
            Whole queue
          </Button>
          <Button variant={queueScope === 'mine' ? 'default' : 'outline'} size="sm" onClick={() => setQueueScope('mine')}>
            My tickets
          </Button>
          <Button variant={queueScope === 'unassigned' ? 'default' : 'outline'} size="sm" onClick={() => setQueueScope('unassigned')}>
            Unassigned
          </Button>
        </div>
      ) : null}

      <div className="flex h-[calc(100vh-20rem)] overflow-hidden rounded-2xl border bg-white">
        <div className="w-[360px] border-r bg-slate-50">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Tickets</h2>
          </div>
          <div className="h-full overflow-y-auto p-3">
            {loading ? (
              <div className="rounded-xl border bg-white px-4 py-6 text-sm text-slate-500">Loading tickets…</div>
            ) : tickets.length === 0 ? (
              <div className="rounded-xl border bg-white px-4 py-6 text-sm text-slate-500">No tickets in this view.</div>
            ) : (
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setActiveTicketId(ticket.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      ticket.id === activeTicketId
                        ? 'border-indigo-200 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{ticket.subject}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {mode === 'superadmin'
                            ? ticket.tenants?.name || ticket.tenant_id || 'Unknown tenant'
                            : ticket.priority || 'normal'}
                        </div>
                      </div>
                      <Badge variant={statusTone(ticket.status)}>{ticket.status}</Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{prettyDate(ticket.updated_at)}</span>
                      <span>{ticket.assignee_id ? 'Assigned' : 'Unassigned'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="border-b bg-white px-5 py-4">
            {activeTicket ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{activeTicket.subject}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{mode === 'superadmin' ? activeTicket.tenants?.name || activeTicket.tenant_id : `Created ${prettyDate(activeTicket.created_at)}`}</span>
                    <Badge variant={statusTone(activeTicket.status)}>{activeTicket.status}</Badge>
                    {mode === 'superadmin' ? (
                      <span>{activeTicket.assignee_id ? `Assigned to ${activeTicket.assignee_id}` : 'Unassigned'}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mode === 'superadmin' ? (
                    activeTicket.assignee_id ? (
                      <Button size="sm" variant="outline" onClick={unassignTicket} disabled={saving}>
                        Unassign
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={claimTicket} disabled={saving}>
                        Claim
                      </Button>
                    )
                  ) : null}
                  {STATUS_OPTIONS.map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={thread?.ticket.status === status ? 'default' : 'outline'}
                      onClick={() => updateStatus(status)}
                      disabled={saving || thread?.ticket.status === status}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Select a support ticket to view the thread.</div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
            {!activeTicketId ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
                Choose a ticket from the list to see details.
              </div>
            ) : detailLoading ? (
              <div className="rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-500">
                Loading support thread…
              </div>
            ) : thread ? (
              <div className="space-y-4">
                {thread.ticket.description ? (
                  <Card>
                    <CardContent className="p-4 text-sm text-slate-700">{thread.ticket.description}</CardContent>
                  </Card>
                ) : null}
                {thread.messages.map((item) => (
                  <div
                    key={item.id}
                    className={`max-w-3xl rounded-2xl px-4 py-3 shadow-sm ${
                      item.is_internal
                        ? 'border border-amber-200 bg-amber-50 text-amber-900'
                        : item.author_role === 'support'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-900'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs opacity-80">
                      <span>
                        {item.is_internal
                          ? 'Internal note'
                          : item.author_role === 'support'
                            ? 'Booka Support'
                            : 'Tenant'}
                      </span>
                      <span>{prettyDate(item.created_at)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-6">{item.body}</div>
                  </div>
                ))}
                {thread.assignments.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Assignment History</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {thread.assignments.map((assignment) => (
                        <div key={assignment.id} className="text-xs text-slate-600">
                          Assigned to <span className="font-medium text-slate-900">{assignment.assigned_to}</span> on {prettyDate(assignment.created_at)}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-500">
                Unable to load this ticket thread.
              </div>
            )}
          </div>

          <div className="border-t bg-white p-4">
            <div className="space-y-3">
              <Textarea
                placeholder={
                  mode === 'superadmin'
                    ? internalNote
                      ? 'Add an internal note for the support team'
                      : 'Reply as Booka support'
                    : 'Reply to this support ticket'
                }
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={!activeTicketId || saving}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {mode === 'superadmin'
                    ? 'This thread is for tenant-to-Booka platform support, not customer inbox operations.'
                    : role === 'staff'
                      ? 'You can reply and create tickets. Status changes are also visible to your team.'
                      : 'Use the inbox for tenant-customer support. This desk is only for Booka platform help.'}
                </div>
                <div className="flex items-center gap-3">
                  {mode === 'superadmin' ? (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={internalNote}
                        onChange={(event) => setInternalNote(event.target.checked)}
                        disabled={!activeTicketId || saving}
                      />
                      Internal note
                    </label>
                  ) : null}
                  <Button onClick={sendMessage} disabled={!activeTicketId || !message.trim() || saving}>
                    {saving ? 'Sending…' : internalNote ? 'Save Note' : 'Send Reply'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
