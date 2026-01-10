import React from 'react'
// Converted from Vitest to Jest APIs
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReservationForm from '../ReservationForm'
jest.mock('@/lib/supabase/client', () => {
  const mock = {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  }
  return { getBrowserSupabase: () => mock, default: mock, supabase: mock }
})

describe('ReservationForm', () => {
  beforeEach(() => {
    type Mock = jest.Mock
    ;(global as unknown as { fetch: Mock }).fetch = jest.fn() as Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
    delete (global as unknown as { fetch?: unknown }).fetch
  })

  it('submits and calls onCreated with returned id', async () => {
    const createdId = 'res-123'
    ;(global.fetch as unknown as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ id: createdId }) })

    const onCreated = jest.fn()
    render(<ReservationForm tenantId="t1" defaultDateIso="2025-12-01" onCreated={onCreated} />)

    // fill form
    await userEvent.type(screen.getByLabelText(/Name/i), 'Test User')
    await userEvent.type(screen.getByLabelText(/Phone/i), '555')
    await userEvent.type(screen.getByLabelText(/Service/i), 'Haircut')

    // submit
    userEvent.click(screen.getByRole('button', { name: /Create/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdId))
  })
})
