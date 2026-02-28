// Jest globals are available without import
import { DELETE as staffSkillDELETE } from '@/app/api/staff-skills/[user_id]/[skill_id]/route';

const MOCK_USER = { id: 'u1', email: 'owner@test.com' };
const MOCK_TENANT = { tenant_id: 't1', role: 'owner' };
const MOCK_SKILL_ASSIGNMENT = { tenant_id: 't1' };

// Mock supabase server client (used for data queries after auth)
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({}) }) }) }),
  getBrowserSupabase: () => ({})
}));

// Mock the bearer client used for auth token verification
jest.mock('@/lib/supabase/bearer-client', () => ({
  createSupabaseBearerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: MOCK_USER }, error: null })
    },
    from(table: string) {
      if (table === 'tenant_users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: MOCK_TENANT, error: null }) }) }) })
        };
      }
      if (table === 'staff_skills') {
        const selectChain = { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: MOCK_SKILL_ASSIGNMENT, error: null }) }) }) }) };
        const deleteChain = { delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
        return { ...selectChain, ...deleteChain };
      }
      return { select: () => ({ eq: () => ({}) }) };
    }
  })
}));

describe('staff-skill DELETE API route', () => {
  it('DELETE unassign returns ok', async () => {
    const req = new Request('http://x/api/staff-skills/u1/s1', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer test-token',
        'x-tenant-id': 't1'
      }
    });
    const res: any = await staffSkillDELETE(req as any, { params: { user_id: 'u1', skill_id: 's1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
  });
});
