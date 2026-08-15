// @ts-nocheck
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReservationForm from '../ReservationForm'

jest.mock('@/lib/supabase/client', () => {
  const mock = {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  }
  return { getSupabaseBrowserClient: () => mock, getSupabaseBrowserClientAsync: async () => mock, getBrowserSupabase: () => mock, default: mock, supabase: mock }
})

describe('ReservationForm', () => {
  beforeEach(() => {
    ;(global as unknown as Record<string, unknown>).fetch = jest.fn()
  })

  afterEach(() => {
    jest.resetAllMocks()
    delete (global as unknown as Record<string, unknown>).fetch
  })

  it('submits and calls onCreated with returned id', async () => {
    const createdId = 'res-123'
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ id: createdId }) })

    const onCreated = jest.fn()
    render(<ReservationForm tenantId="t1" defaultDateIso="2025-12-01" onCreated={onCreated} />)

    const inputs = screen.getAllByRole('textbox')
    // Name is first textbox, Phone is second, Service is third
    await userEvent.type(inputs[0], 'Test User')
    await userEvent.type(inputs[1], '555')
    await userEvent.type(inputs[2], 'Haircut')

    await userEvent.click(screen.getByRole('button', { name: /Create/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdId))
  })
})
