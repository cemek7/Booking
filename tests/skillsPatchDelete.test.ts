// Jest globals are available without import
import { PATCH as skillPATCH, DELETE as skillDELETE } from '@/app/api/skills/[id]/route';

function makeSupabase() {
  const skills = [{ id: 's1', name: 'Cut', category: 'Hair' }];
  return {
    from(table: string) {
      if (table === 'skills') {
        return {
          update(patch: any) { this._patch = patch; return this; }, eq(_c: string, id: string) { this._id = id; return this; }, select() { return this; }, maybeSingle() { const sk = skills.find(s => s.id === this._id); if (sk) Object.assign(sk, this._patch); return Promise.resolve({ data: sk, error: null }); },
          delete() { return { eq(_c: string, id: string) { const idx = skills.findIndex(s => s.id === id); if (idx >= 0) skills.splice(idx,1); return Promise.resolve({ error: null }); } } }
        } as any;
      }
      return { select() { return this; } } as any;
    }
  } as any;
}

jest.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => makeSupabase(), getBrowserSupabase: () => ({}) }));

describe('skills PATCH/DELETE API route', () => {
  it('PATCH updates name', async () => {
    const req = new Request('http://x/api/skills/s1', { method: 'PATCH', body: JSON.stringify({ name: 'Styled Cut' }) });
    const res: any = await skillPATCH(req, { params: { id: 's1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skill).toHaveProperty('name', 'Styled Cut');
  });
  it('DELETE removes skill', async () => {
    const req = new Request('http://x/api/skills/s1', { method: 'DELETE' });
    const res: any = await skillDELETE(req, { params: { id: 's1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
  });
});
