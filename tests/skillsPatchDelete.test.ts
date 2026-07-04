// @ts-nocheck
// Jest globals are available without import
import { NextRequest } from 'next/server';
import { PATCH as skillPATCH, DELETE as skillDELETE } from '@/app/api/skills/[id]/route';

const skills = [{ id: 's1', name: 'Cut', category: 'Hair', tenant_id: 'test-tenant-id' }];

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
          then: (resolve: any) =>
            resolve({ data: [{ tenant_id: 'test-tenant-id', role: 'owner' }], error: null }),
        };
      }
      if (table === 'skills') {
        return {
          update(patch: any) { this._patch = patch; return this; },
          delete() {
            return {
              eq: jest.fn().mockImplementation((_c: string, id: string) => {
                const idx = skills.findIndex(s => s.id === id);
                if (idx >= 0) skills.splice(idx, 1);
                return Promise.resolve({ error: null });
              }),
            };
          },
          select() { return this; },
          eq: jest.fn().mockImplementation(function (_c: string, id: string) {
            this._id = id;
            return this;
          }),
          maybeSingle: jest.fn().mockImplementation(function () {
            const sk = skills.find(s => s.id === this._id);
            if (this._patch && sk) Object.assign(sk, this._patch);
            return Promise.resolve({ data: sk ?? null, error: null });
          }),
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

describe('skills PATCH/DELETE API route', () => {
  it('PATCH updates name', async () => {
    const req = new NextRequest('http://x/api/skills/s1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Styled Cut' }),
    });
    const res: any = await skillPATCH(req, { params: { id: 's1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skill).toHaveProperty('name', 'Styled Cut');
  });

  it('DELETE removes skill', async () => {
    const req = new NextRequest('http://x/api/skills/s1', { method: 'DELETE' });
    const res: any = await skillDELETE(req, { params: { id: 's1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('ok', true);
  });
});
