// Shared Supabase mock used by unit tests.
// Converted to Jest APIs

export type MockSupabase = {
  auth: {
    getSession: unknown
    onAuthStateChange: unknown
    signOut: unknown
    signInWithOtp: unknown
  }
  from: unknown
  channel: unknown
  [k: string]: unknown
}

export function createSupabaseMock(overrides: Record<string, unknown> = {}): MockSupabase {
  const mock: MockSupabase = {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      signInWithOtp: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockResolvedValue({}) })),
    // allow arbitrary method access
    ...overrides,
  }

  // default `from` -> chainable select/eq/order helpers returning promises
  ;(mock.from as unknown as { mockImplementation: (impl: unknown) => void }).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [] }) }),
        maybeSingle: () => Promise.resolve({ data: null }),
      }),
      maybeSingle: () => Promise.resolve({ data: null }),
    }),
  }))

  return mock
}

const defaultMock = createSupabaseMock()

// Expose the same shapes tests expect: default export, named export `supabase`, and helper
export default defaultMock
export const supabase = defaultMock
