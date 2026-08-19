// Jest globals are available without import
// @ts-nocheck
import { NextRequest } from 'next/server';
import { GET as skillsGET, POST as skillsPOST } from '@/app/api/skills/route';

const skillsList: Array<Record<string, unknown>> = [];
const inserted: Array<Record<string, unknown>> = [];

jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: jest.fn().mockImplementation(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { tenant_id: 'test-tenant-id', role: 'owner' },
            error: null,
          }),
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: [{ tenant_id: 'test-tenant-id', role: 'owner' }], error: null }),
        };
      }
      if (table === 'skills') {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return Promise.resolve({ data: skillsList, error: null }); },
          insert(row: Record<string, unknown>) {
            const record = { id: 's1', ...row };
            inserted.push(record);
            return {
              select() { return this; },
              maybeSingle() { return Promise.resolve({ data: record, error: null }); },
            };
          },
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  })),
}));

describe('skills API route', () => {
  beforeEach(() => {
    skillsList.length = 0;
    inserted.length = 0;
  });

  it('GET returns skills list for authenticated user', async () => {
    const res = await skillsGET(new NextRequest('http://x/api/skills')) as Response;
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toHaveProperty('skills');
  });

  it('POST creates skill', async () => {
    const res = await skillsPOST(new NextRequest('http://x/api/skills', {
      method: 'POST',
      body: JSON.stringify({ name: 'Haircut' })
    }));
    const json = await (res as Response).json();
    expect(json.skill).toHaveProperty('name', 'Haircut');
  });
});
