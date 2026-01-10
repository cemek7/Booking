// Jest globals are available without import
import { GET as skillsGET, POST as skillsPOST } from '@/app/api/skills/route';

// Minimal Supabase stub for tests
function makeSupabase(list: any[] = [], inserted: any[] = []) {
  return {
    from(table: string) {
      if (table === 'skills') {
        return {
          select() { return this; }, eq() { return this; }, order() { return Promise.resolve({ data: list, error: null }); },
          insert(row: any) { inserted.push(row); return { select() { return this; }, maybeSingle() { return Promise.resolve({ data: { id: 's1', ...row }, error: null }); } } }
        } as any;
      }
      return { select() { return this; } } as any;
    }
  } as any;
}

// Monkey patch createServerSupabaseClient to return stub
jest.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => makeSupabase(), getBrowserSupabase: () => ({}) }));

describe('skills API route', () => {
  it('GET requires tenant_id', async () => {
    const res = await skillsGET(new Request('http://x/api/skills')) as any;
    expect(await res.json()).toHaveProperty('error');
  });
  it('POST creates skill', async () => {
    const res = await skillsPOST(new Request('http://x/api/skills', { method: 'POST', body: JSON.stringify({ tenant_id: 't1', name: 'Haircut' }) }));
    const json = await (res as any).json();
    expect(json.skill).toHaveProperty('name', 'Haircut');
  });
});
