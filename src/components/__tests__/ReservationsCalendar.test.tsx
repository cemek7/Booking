import React from 'react'
// Converted from Vitest to Jest APIs
import { render, screen, waitFor } from '@testing-library/react'
import ReservationsCalendar from '../ReservationsCalendar'
jest.mock('@/lib/supabase/client', () => {
  const mock = {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'reservations') return { select: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ order: () => Promise.resolve({ data: [ { id: 'r1', tenant_id: 't1', start_at: new Date().toISOString(), service: 'Test Service' } ] }) }) }) }) }) }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }
    })
  }
  return { getBrowserSupabase: () => mock, default: mock, supabase: mock }
})

describe('ReservationsCalendar', () => {
  it('renders reservations from the month range', async () => {
    render(<ReservationsCalendar tenantId="t1" />)
    await waitFor(() => expect(screen.getByText(/Test Service/)).toBeInTheDocument())
  })
})
