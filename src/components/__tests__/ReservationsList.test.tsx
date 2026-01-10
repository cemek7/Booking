import React from 'react'
// Converted from Vitest to Jest APIs
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReservationsList from '../reservations/ReservationsList'

import { createSupabaseMock } from '@/test/supabaseMock'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeQueryClient } from '@/lib/queryClient'
type Mock = jest.Mock

// Mock supabase client module with a simple static mock
jest.mock('@/lib/supabase/client', () => {
  const mockSupabase = createSupabaseMock({
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'user-1' } } } }) }
  })
  return { getBrowserSupabase: () => mockSupabase, default: mockSupabase, supabase: mockSupabase }
})

describe('ReservationsList', () => {
  beforeEach(() => {
    // reset fetch mock
    type Mock = jest.Mock
    ;(global as unknown as { fetch: Mock }).fetch = jest.fn() as Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
    delete (global as unknown as { fetch?: unknown }).fetch
  })

  it('renders reservations and supports delete flow', async () => {
    const mockReservations = [
      { id: 'r1', tenant_id: 'tenant-1', customer_id: 'Alice', status: 'confirmed', date: new Date().toISOString(), created_at: new Date().toISOString() },
      { id: 'r2', tenant_id: 'tenant-1', customer_id: 'Bob', status: 'pending', date: new Date().toISOString(), created_at: new Date().toISOString() }
    ]

    // First call: GET /api/reservations
    type FetchResponse<T=unknown> = { ok: boolean; json: () => Promise<T> }
    ;(global as unknown as { fetch: Mock }).fetch.mockResolvedValueOnce({ ok: true, json: async () => mockReservations } as FetchResponse<typeof mockReservations>)

    const qc = makeQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <ReservationsList />
      </QueryClientProvider>
    )

    // Verify rows render with customer_id values
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('Bob')).toBeInTheDocument()

    // Next call: DELETE /api/reservations?id=eq.r1
    ;(global as unknown as { confirm: (msg?: string) => boolean }).confirm = () => true
    ;(global as unknown as { fetch: Mock }).fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as FetchResponse<Record<string, never>>)

    const delBtn = screen.getAllByText('Delete')[0]
    userEvent.click(delBtn)

    // Button should show Deleting... then reset
    await waitFor(() => expect(screen.getByText('Deleting...')).toBeInTheDocument())
  })
})
