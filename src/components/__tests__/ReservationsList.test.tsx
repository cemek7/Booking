// @ts-nocheck
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReservationsList from '../reservations/ReservationsList'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeQueryClient } from '@/lib/queryClient'

// Mock authFetch to avoid actual HTTP calls and auth header issues
jest.mock('@/lib/auth/auth-api-client', () => ({
  authFetch: jest.fn(),
  authGet: jest.fn(),
  authPost: jest.fn(),
  authDelete: jest.fn(),
  authPatch: jest.fn(),
}))

const { authFetch } = require('@/lib/auth/auth-api-client')

const mockReservations = [
  // customer is shown by number/name (not the internal customer_id UUID)
  { id: 'r1', tenant_id: 'tenant-1', customer_id: 'cust-uuid-1', customer_number: 'Alice', status: 'confirmed', date: new Date().toISOString(), created_at: new Date().toISOString() },
  { id: 'r2', tenant_id: 'tenant-1', customer_id: 'cust-uuid-2', customer_number: 'Bob', status: 'pending', date: new Date().toISOString(), created_at: new Date().toISOString() }
]

describe('ReservationsList', () => {
  beforeEach(() => {
    // Return reservations list on first call, empty on subsequent (services, etc.)
    authFetch.mockResolvedValue({ status: 200, data: [] })
    authFetch.mockResolvedValueOnce({ status: 200, data: mockReservations })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders reservations list with delete buttons', async () => {
    const qc = makeQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <ReservationsList />
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getAllByText('Delete').length).toBeGreaterThan(0)
  })

  it('calls delete API when delete button is clicked', async () => {
    ;(global as unknown as Record<string, unknown>).confirm = () => true
    authFetch.mockResolvedValueOnce({ status: 200, data: mockReservations })

    const qc = makeQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <ReservationsList />
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 3000 })

    const delBtn = screen.getAllByText('Delete')[0]
    await userEvent.click(delBtn)

    await waitFor(() => {
      const deleteCalls = authFetch.mock.calls.filter(
        call => call[1]?.method === 'DELETE'
      )
      expect(deleteCalls.length).toBeGreaterThan(0)
    })
  })
})
