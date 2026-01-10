// Jest globals are available without import
import { DELETE as staffSkillDELETE } from '@/app/api/staff-skills/[user_id]/[skill_id]/route';

// Minimal stubs for staff_skills chainable calls in the route

// Simplify: treat chained delete().eq().eq() as immediate removal
jest.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => ({
  from(table: string) {
    if (table === 'staff_skills') {
      return {
        delete() { return { eq(_c: string, _v: string) { return { eq(_c2: string, _v2: string) { return Promise.resolve({ error: null }); } }; } }
      } as any;
    }
    return { select() { return this; } } as any;
  }
}), getBrowserSupabase: () => ({}) }));

describe('staff-skill DELETE API route', () => {
  it('DELETE unassign returns ok', async () => {
    const req = new Request('http://x/api/staff-skills/u1/s1', { method: 'DELETE' });
    const res: any = await staffSkillDELETE(req, { params: { user_id: 'u1', skill_id: 's1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
  });
});
